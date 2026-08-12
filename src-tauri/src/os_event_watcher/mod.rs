//! OS event watcher — Tauri main(Rust) side OS API access.
//!
//! Polls OS-wide idle state and the frontmost window, appends the transitions
//! to the witness log, then emits `os_event` IPC events to the webview.
//!
//! Platform support:
//!   macOS  — fully implemented (CGEventSource, CGWindowList)
//!   Windows — fully implemented (GetLastInputInfo, EnumWindows)
//!   Android — cfg-gated no-op degrade
//!   other  — idle-source error emitted, no panic

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::witness::{Sample, WitnessLog};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::{command, AppHandle, Emitter};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::{Manager, Runtime};

pub const OS_EVENT_CHANNEL: &str = "os_event";

/// Channel for the drag-drop release signal emitted after `start_dragging()`.
#[allow(dead_code)] // consumed by platform drop-release probes; dead on unsupported targets
pub const WINDOW_DROP_RELEASE_CHANNEL: &str = "window_drop_release";

#[cfg(any(target_os = "macos", target_os = "windows"))]
const POLL_INTERVAL: Duration = Duration::from_secs(5);
#[cfg(any(target_os = "macos", target_os = "windows"))]
const RELEASE_POLL_INTERVAL: Duration = Duration::from_millis(16);
#[cfg(any(target_os = "macos", target_os = "windows"))]
const RELEASE_POLL_TIMEOUT: Duration = Duration::from_secs(10);

/// `os_event` channel payload — "Rust → Webview" handoff.
#[derive(Debug, Clone, Serialize)]
pub struct OsEventPayload {
    /// "os_idle_tick"
    pub event_name: String,
    /// client epoch ms
    pub ts: i64,
    pub data: OsEventData,
}

/// `data` block — all fields optional; each event_name populates different fields.
#[derive(Debug, Clone, Default, Serialize)]
pub struct OsEventData {
    /// OS-wide idle (ms). macOS `CGEventSourceSecondsSinceLastEventType`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_idle_ms: Option<u64>,
    /// Owner app of the frontmost window (unresolved on Windows).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmost_app: Option<String>,
    /// Title of the frontmost window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmost_title: Option<String>,
}

/// Returns current epoch milliseconds.
pub fn epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Converts idle seconds (f64) to milliseconds (u64), clamping negative to 0.
#[allow(dead_code)] // used by the macOS watcher; dead on other targets
pub fn idle_ms_from_secs(secs: f64) -> u64 {
    if secs < 0.0 {
        0
    } else {
        (secs * 1000.0) as u64
    }
}

/// Sanitises a raw window title: trims, returns None if empty.
#[allow(dead_code)] // used by platform watchers; dead on unsupported targets
pub fn sanitise_window_title(raw: &str) -> Option<String> {
    let s = raw.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Emits one OS event to the webview (fire-and-forget).
pub fn emit_os_event(app: &AppHandle, payload: OsEventPayload) -> tauri::Result<()> {
    let result = app.emit(OS_EVENT_CHANNEL, payload);
    if let Err(e) = &result {
        log::warn!("os_event_emit_failed error={e}");
    }
    result
}

// ─── Window-sit drop: release signal + window list ───────────────────────────

/// One on-screen window, all measurements in points (top-left origin).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowAtPoint {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub name: Option<String>,
    pub owner_name: Option<String>,
    pub pid: i32,
    /// Stable CoreGraphics window identity (`kCGWindowNumber`).
    pub window_number: u32,
}

/// Lists every foreign on-screen window in front-to-back (topmost first) order,
/// each in logical points (top-left origin).
///
/// Excludes YUI's own pid and platform chrome (menu bar / Dock / wallpaper on
/// macOS; taskbar / desktop on Windows). The frontend uses the full list for
/// the perch top-edge catch zone, whose U-band lies outside the window bounds
/// and so cannot be resolved by a point-in-rect hit-test. Platforms without an
/// enumeration implementation return `Ok(Vec::new())`.
#[command]
pub fn list_windows() -> Result<Vec<WindowAtPoint>, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(macos::list_all_windows())
    }
    #[cfg(target_os = "windows")]
    {
        Ok(windows::list_all_windows())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(Vec::new())
    }
}

// ─── Platform-specific OS polling ────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
use macos::{platform_idle_ms, platform_lbutton_is_down, start_polling};

#[cfg(target_os = "windows")]
use windows::{platform_idle_ms, platform_lbutton_is_down, start_polling};

#[cfg(any(target_os = "macos", target_os = "windows"))]
static PROBE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct ProbeGuard;

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl ProbeGuard {
    fn try_acquire() -> Option<Self> {
        PROBE_ACTIVE
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| ProbeGuard)
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl Drop for ProbeGuard {
    fn drop(&mut self) {
        PROBE_ACTIVE.store(false, Ordering::Release);
    }
}

/// Given the running state-machine state (`saw_down`) and the current button
/// reading (`is_down`), returns the new `saw_down` value and whether a
/// down→up release was just detected.
///
/// This is the pure, FFI-free core of the release logic, unit-testable.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn step_release_detector(saw_down: bool, is_down: bool) -> (bool, bool) {
    if is_down {
        // Button is held; record that we have seen it down.
        (true, false)
    } else if saw_down {
        // We saw it down before, and now it is up: release detected.
        (true, true)
    } else {
        // Button is up but we have not yet observed it down — stale read.
        (false, false)
    }
}

// Drop-release probe, invoked by drag.rs after start_dragging().
// Emits `window_drop_release` as a bare signal (no payload).
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn spawn_drop_release_probe<R: Runtime>(app: AppHandle<R>) {
    let Some(guard) = ProbeGuard::try_acquire() else {
        log::debug!("drop_release_probe_skipped reason=already_active");
        return;
    };

    thread::Builder::new()
        .name("yui_drop_release".into())
        .spawn(move || {
            // Held for the thread's lifetime so every exit path clears PROBE_ACTIVE.
            let _guard = guard;

            let start = std::time::Instant::now();
            let mut saw_down = false;

            loop {
                if start.elapsed() >= RELEASE_POLL_TIMEOUT {
                    log::info!("drop_release_timeout");
                    return;
                }

                let is_down = platform_lbutton_is_down();
                let (next_saw_down, released) = step_release_detector(saw_down, is_down);
                saw_down = next_saw_down;

                if released {
                    break;
                }

                thread::sleep(RELEASE_POLL_INTERVAL);
            }

            log::info!("drop_release_detected");

            if let Err(e) = app.emit(WINDOW_DROP_RELEASE_CHANNEL, ()) {
                log::warn!("window_drop_release_emit_failed error={e}");
            }
        })
        .expect("failed to spawn yui_drop_release thread");
}

/// Owner app and title of the frontmost window, `(None, None)` when there is none.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn frontmost_window() -> (Option<String>, Option<String>) {
    match list_windows().ok().and_then(|w| w.into_iter().next()) {
        Some(w) => (w.owner_name, w.name),
        None => (None, None),
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn polling_loop(app: AppHandle) {
    let mut witness = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| WitnessLog::new(dir.join("witness"), crate::resolve_log_offset()));

    loop {
        let now = epoch_ms();

        // Idle tick, emitted every poll interval.
        let idle = platform_idle_ms();
        let (frontmost_app, frontmost_title) = frontmost_window();

        if let Some(witness) = witness.as_mut() {
            witness.observe(Sample {
                app: frontmost_app.clone(),
                window_title: frontmost_title.clone(),
                idle_ms: idle,
            });
        }

        let _ = emit_os_event(
            &app,
            OsEventPayload {
                event_name: "os_idle_tick".into(),
                ts: now,
                data: OsEventData {
                    os_idle_ms: idle,
                    frontmost_app,
                    frontmost_title,
                },
            },
        );

        thread::sleep(POLL_INTERVAL);
    }
}

// ─── start() — spawns background polling loop ─────────────────────────────────

/// Starts the OS event polling loop as a background thread.
/// Called once from Tauri `setup`.
#[allow(unused_variables)]
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    start_polling(app.clone());

    #[cfg(target_os = "windows")]
    start_polling(app.clone());

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Unsupported platform: emit one idle-source-error tick so the webview
        // knows the source is in error state (degraded recovery).
        let app = app.clone();
        std::thread::spawn(move || {
            // Emit a single error indicator and then exit — no panic.
            let _ = emit_os_event(
                &app,
                OsEventPayload {
                    event_name: "os_idle_tick".into(),
                    ts: epoch_ms(),
                    data: OsEventData::default(),
                },
            );
        });
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── ProbeGuard once-guard ────────────────────────────────────────────────

    #[test]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn probe_guard_serialises_acquire_release() {
        // Clean baseline (process-wide flag shared across tests in this module).
        PROBE_ACTIVE.store(false, Ordering::Release);

        {
            let first = ProbeGuard::try_acquire();
            assert!(first.is_some(), "first acquire must succeed");
            assert!(PROBE_ACTIVE.load(Ordering::Acquire), "flag set while held");

            // A concurrent acquire is refused while the first is held.
            let second = ProbeGuard::try_acquire();
            assert!(
                second.is_none(),
                "second concurrent acquire must be refused"
            );
        }

        // Drop of first guard at end of scope resets the flag.
        assert!(
            !PROBE_ACTIVE.load(Ordering::Acquire),
            "flag cleared on drop"
        );

        // A subsequent acquire after release succeeds.
        let third = ProbeGuard::try_acquire();
        assert!(third.is_some(), "acquire after release must succeed");
        drop(third);
        assert!(
            !PROBE_ACTIVE.load(Ordering::Acquire),
            "flag cleared after final drop"
        );
    }

    // ── step_release_detector — pure helper ──────────────────────────────────

    #[test]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn no_release_before_down_observed() {
        // Button reads up before we ever see it down: stale up-state, no release.
        let (saw_down, released) = step_release_detector(false, false);
        assert!(!saw_down, "saw_down remains false");
        assert!(!released, "must not release without prior down");
    }

    #[test]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn down_sets_saw_down_no_release() {
        // Button goes down: saw_down flips to true, no release yet.
        let (saw_down, released) = step_release_detector(false, true);
        assert!(saw_down, "saw_down set on first down read");
        assert!(!released, "no release while button is still down");
    }

    #[test]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn release_fires_exactly_on_down_to_up_transition() {
        // Already saw the button down (saw_down=true), now it goes up.
        let (saw_down, released) = step_release_detector(true, false);
        assert!(saw_down, "saw_down stays true after release");
        assert!(released, "release detected on down→up transition");
    }

    #[test]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn held_down_does_not_release() {
        // Button is held down while saw_down is already true.
        let (saw_down, released) = step_release_detector(true, true);
        assert!(saw_down, "saw_down stays true while held");
        assert!(!released, "no release while button is still down");
    }

    #[test]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn release_not_fired_again_after_up_while_up() {
        // After a release (saw_down=true, is_down=false), if we keep reading
        // up the detector should not keep emitting releases.  The probe loop
        // breaks immediately on the first release, but we test the helper
        // independently: calling it again with (true, false) would yield
        // another release — the loop's `break` is the guard in practice.
        // What we verify here is that a (false, false) call (post-reset state)
        // never fires a spurious release.
        let (saw_down, released) = step_release_detector(false, false);
        assert!(!released, "no spurious release from pure up-up state");
        assert!(!saw_down);
    }

    #[test]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn full_sequence_no_release_then_release() {
        // Simulate: up (stale), down, down, up (release).
        let mut saw_down = false;

        let (s, r) = step_release_detector(saw_down, false); // stale up
        saw_down = s;
        assert!(!r);

        let (s, r) = step_release_detector(saw_down, true); // first down
        saw_down = s;
        assert!(!r);
        assert!(saw_down);

        let (s, r) = step_release_detector(saw_down, true); // held down
        saw_down = s;
        assert!(!r);

        let (_s, r) = step_release_detector(saw_down, false); // release
        assert!(r, "release detected at down→up");
    }

    // ── existing contract tests (must stay green) ────────────────────────────

    #[test]
    fn channel_name_is_stable() {
        assert_eq!(OS_EVENT_CHANNEL, "os_event");
    }

    #[test]
    fn data_skips_none_fields() {
        let v = serde_json::to_value(OsEventData::default()).unwrap();
        assert_eq!(v, json!({}));
    }

    #[test]
    fn payload_shape_matches_ipc_contract() {
        let payload = OsEventPayload {
            event_name: "os_idle_tick".into(),
            ts: 123,
            data: OsEventData {
                os_idle_ms: Some(5000),
                ..Default::default()
            },
        };
        let v = serde_json::to_value(payload).unwrap();
        assert_eq!(
            v,
            json!({ "event_name": "os_idle_tick", "ts": 123, "data": { "os_idle_ms": 5000 } })
        );
    }

    #[test]
    fn data_carries_frontmost_fields() {
        let v = serde_json::to_value(OsEventData {
            os_idle_ms: Some(0),
            frontmost_app: Some("Safari".into()),
            frontmost_title: Some("Start Page".into()),
        })
        .unwrap();
        assert_eq!(
            v,
            json!({
                "os_idle_ms": 0,
                "frontmost_app": "Safari",
                "frontmost_title": "Start Page",
            })
        );
    }

    // ── idle_ms_from_secs ────────────────────────────────────────────────────

    #[test]
    fn idle_ms_rounds_fractional_seconds() {
        // 1.5s → 1500ms
        assert_eq!(idle_ms_from_secs(1.5), 1500);
    }

    #[test]
    fn idle_ms_clamps_negative_to_zero() {
        // negative idle is nonsensical — clamp to 0
        assert_eq!(idle_ms_from_secs(-1.0), 0);
    }

    #[test]
    fn idle_ms_zero() {
        assert_eq!(idle_ms_from_secs(0.0), 0);
    }

    #[test]
    fn idle_ms_large_value() {
        // 3600s = 1h → 3_600_000ms
        assert_eq!(idle_ms_from_secs(3600.0), 3_600_000);
    }

    // ── sanitise_window_title ───────────────────────────────────────────────

    #[test]
    fn sanitise_window_title_trims_and_preserves() {
        assert_eq!(
            sanitise_window_title("  My Document.pdf  "),
            Some("My Document.pdf".into())
        );
    }

    #[test]
    fn sanitise_window_title_empty_returns_none() {
        assert_eq!(sanitise_window_title(""), None);
    }

    // ── epoch_ms sanity ──────────────────────────────────────────────────────

    #[test]
    fn epoch_ms_is_positive() {
        assert!(epoch_ms() > 0);
    }

    #[test]
    fn epoch_ms_is_reasonable_year() {
        // Must be after 2024-01-01 epoch ms = 1_704_067_200_000
        assert!(epoch_ms() > 1_704_067_200_000);
    }

    // ── WindowAtPoint serialisation ──────────────────────────────────────────

    #[test]
    fn window_at_point_serialises_camel_case() {
        let w = WindowAtPoint {
            x: 100.0,
            y: 200.0,
            width: 800.0,
            height: 600.0,
            name: Some("Start Page".into()),
            owner_name: Some("Safari".into()),
            pid: 4321,
            window_number: 8765,
        };
        let v = serde_json::to_value(&w).unwrap();
        assert_eq!(v["x"], 100.0);
        assert_eq!(v["y"], 200.0);
        assert_eq!(v["width"], 800.0);
        assert_eq!(v["height"], 600.0);
        assert_eq!(v["name"], "Start Page");
        assert_eq!(v["ownerName"], "Safari");
        assert_eq!(v["pid"], 4321);
        assert_eq!(v["windowNumber"], 8765);
    }

    #[test]
    fn window_at_point_serialises_null_name() {
        let w = WindowAtPoint {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
            name: None,
            owner_name: None,
            pid: 1,
            window_number: 42,
        };
        let v = serde_json::to_value(&w).unwrap();
        assert!(v["name"].is_null());
        assert!(v["ownerName"].is_null());
        assert_eq!(v["windowNumber"], 42);
    }
}
