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
use std::{thread, time::Duration};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::Manager;
use tauri::{command, AppHandle, Emitter};

pub const OS_EVENT_CHANNEL: &str = "os_event";

/// Channel for the drag-drop release signal emitted after `start_dragging()`.
#[allow(dead_code)] // consumed by platform drop-release probes; dead on unsupported targets
pub const WINDOW_DROP_RELEASE_CHANNEL: &str = "window_drop_release";

#[cfg(any(target_os = "macos", target_os = "windows"))]
const POLL_INTERVAL: Duration = Duration::from_secs(5);

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
    /// Owner app of the frontmost window (process base name on Windows).
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

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) mod drop_release;
mod pure_helpers;

// ─── Platform-specific OS polling ────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
use macos::{platform_frontmost, platform_idle_ms, platform_lbutton_is_down};

#[cfg(target_os = "windows")]
use windows::{platform_frontmost, platform_idle_ms, platform_lbutton_is_down};

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn polling_loop(app: AppHandle) {
    let mut witness = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| WitnessLog::new(dir.join("witness"), crate::app_log::resolve_log_offset()));

    loop {
        let now = epoch_ms();

        // Idle tick, emitted every poll interval.
        let idle = platform_idle_ms();
        let (frontmost_app, frontmost_title) = platform_frontmost();
        // Cap at the sampler so the IPC payload and the witness log share one bound.
        let frontmost_app = crate::witness::cap_text(frontmost_app);
        let frontmost_title = crate::witness::cap_text(frontmost_title);
        let sample = Sample {
            app: frontmost_app.clone(),
            window_title: frontmost_title.clone(),
            idle_ms: idle,
        };

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

        // Disk write trails the tick: fs latency must not delay the dispatcher.
        if let Some(witness) = witness.as_mut() {
            witness.observe(sample);
        }

        thread::sleep(POLL_INTERVAL);
    }
}

// ─── start() — spawns background polling loop ─────────────────────────────────

#[cfg(target_os = "macos")]
const POLL_THREAD_NAME: &str = "os_event_watcher";
#[cfg(target_os = "windows")]
const POLL_THREAD_NAME: &str = "os_event_watcher_win";

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn start_polling(app: AppHandle) {
    thread::Builder::new()
        .name(POLL_THREAD_NAME.into())
        .spawn(move || polling_loop(app))
        .unwrap_or_else(|e| panic!("failed to spawn {POLL_THREAD_NAME} thread: {e}"));
}

/// Starts the OS event polling loop as a background thread.
/// Called once from Tauri `setup`.
pub fn start(app: &AppHandle) {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
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
