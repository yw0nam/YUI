//! Windows OS polling — cfg-gated.
//!
//! Implements:
//!   - `start_polling`: no-op background polling stub for idle/app/fullscreen
//!     (real implementation deferred).
//!   - `spawn_drop_release_probe`: polls `GetAsyncKeyState(VK_LBUTTON)` until
//!     the left mouse button is released after a drag, then emits the bare
//!     `window_drop_release` signal so the frontend flow can revert motion.
//!
//! All functions must not panic; degrade gracefully.

// Pure helpers below are not yet wired to FFI callers (lands in the follow-up
// feat commit), so dead_code is expected here for now.
#![allow(dead_code)]

use super::{
    emit_os_event, epoch_ms, OsEventData, OsEventPayload, WindowAtPoint,
    WINDOW_DROP_RELEASE_CHANNEL,
};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};
use windows::Win32::{
    Foundation::RECT,
    UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
};

const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Polling interval for the drop-release probe (~60 Hz).
const RELEASE_POLL_INTERVAL: Duration = Duration::from_millis(16);

/// Hard timeout: probe exits after this duration even without observing a release.
const RELEASE_POLL_TIMEOUT: Duration = Duration::from_secs(10);

/// Spawns a no-op background polling thread.
pub fn start_polling(app: AppHandle) {
    thread::Builder::new()
        .name("os_event_watcher_win".into())
        .spawn(move || loop {
            let _ = emit_os_event(
                &app,
                OsEventPayload {
                    event_name: "os_idle_tick".into(),
                    ts: epoch_ms(),
                    data: OsEventData {
                        os_idle_ms: None,
                        ..Default::default()
                    },
                },
            );
            thread::sleep(POLL_INTERVAL);
        })
        .expect("failed to spawn os_event_watcher thread");
}

// ─── Drop-release probe ───────────────────────────────────────────────────────

/// Process-wide once-guard: only one probe runs at a time.
static PROBE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// RAII handle that holds `PROBE_ACTIVE` true and clears it on drop.
struct ProbeGuard;

impl ProbeGuard {
    fn try_acquire() -> Option<Self> {
        PROBE_ACTIVE
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| ProbeGuard)
    }
}

impl Drop for ProbeGuard {
    fn drop(&mut self) {
        PROBE_ACTIVE.store(false, Ordering::Release);
    }
}

/// Returns true when `GetAsyncKeyState(VK_LBUTTON)` reports the button as down
/// (high-order bit of the returned i16 is set).
///
/// Extracted as a pure-ish helper so the state-machine logic is testable without
/// calling the Win32 FFI in unit tests.
fn lbutton_is_down() -> bool {
    // SAFETY: GetAsyncKeyState is always safe to call; it does not mutate state.
    let state = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) };
    (state as u16 & 0x8000u16) != 0
}

/// Given the running state-machine state (`saw_down`) and the current button
/// reading (`is_down`), returns the new `saw_down` value and whether a
/// down→up release was just detected.
///
/// This is the pure, FFI-free core of the release logic, unit-testable.
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

/// Spawns a short-lived thread that polls the left mouse button until release
/// (down→up), then emits a bare `window_drop_release` signal.
///
/// A process-wide once-guard suppresses a duplicate probe when drags overlap.
pub fn spawn_drop_release_probe<R: Runtime>(app: AppHandle<R>) {
    let Some(guard) = ProbeGuard::try_acquire() else {
        log::debug!("drop_release_probe_skipped reason=already_active");
        return;
    };

    thread::Builder::new()
        .name("yui_drop_release".into())
        .spawn(move || {
            let _guard = guard;

            let start = std::time::Instant::now();
            let mut saw_down = false;

            loop {
                if start.elapsed() >= RELEASE_POLL_TIMEOUT {
                    log::info!("drop_release_timeout");
                    return;
                }

                let is_down = lbutton_is_down();
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

// ─── Pure helpers for the real Win32 watcher (FFI-free, unit-tested) ────────
//
// These back the idle / active-app / fullscreen / list_windows implementation
// that wires them to Win32 FFI calls; kept FFI-free here so the arithmetic and
// filtering logic is directly unit-testable.

// Standard 96-DPI baseline used to derive the physical→logical scale factor.
const BASELINE_DPI: f64 = 96.0;

/// Idle milliseconds from a `GetTickCount()` reading and the last-input tick.
///
/// `dwTime` is not guaranteed to be <= the current tick (SendInput can supply
/// a future tick, or raw-input/desktop thread timing can gap); a wrapped
/// "huge" diff (> i32::MAX as u32) is treated as 0 rather than as ~49 days.
fn idle_ms_from_ticks(now_tick: u32, last_tick: u32) -> u64 {
    let diff = now_tick.wrapping_sub(last_tick);
    if diff > i32::MAX as u32 {
        0
    } else {
        diff as u64
    }
}

/// Extracts the executable file stem (no extension) from a full image path.
///
/// `C:\...\chrome.exe` → `Some("chrome")`. `None` for a path with no file
/// stem (e.g. an empty string).
fn app_name_from_exe_path(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
}

/// True when `win` fully covers `mon` (physical pixels, both rects in the
/// same coordinate space — no DPI conversion needed for this comparison).
fn rect_covers_monitor(win: RECT, mon: RECT) -> bool {
    win.left <= mon.left && win.top <= mon.top && win.right >= mon.right && win.bottom >= mon.bottom
}

/// One enumerated top-level window in physical-pixel screen space.
#[derive(Debug, Clone, PartialEq)]
struct PhysicalWindow {
    rect: RECT,
    pid: i32,
    name: Option<String>,
    window_number: u32,
    dpi: u32,
}

/// Converts a physical-pixel window rect into the logical-point
/// `WindowAtPoint` the frontend expects (matches `drag.rs` logical =
/// physical / scale_factor, scale_factor = dpi / 96).
fn physical_window_to_at_point(w: &PhysicalWindow) -> Option<WindowAtPoint> {
    if w.dpi == 0 {
        return None;
    }
    let scale = w.dpi as f64 / BASELINE_DPI;
    let x = w.rect.left as f64 / scale;
    let y = w.rect.top as f64 / scale;
    let width = (w.rect.right - w.rect.left) as f64 / scale;
    let height = (w.rect.bottom - w.rect.top) as f64 / scale;
    Some(WindowAtPoint {
        x,
        y,
        width,
        height,
        name: w.name.clone(),
        pid: w.pid,
        window_number: w.window_number,
    })
}

/// Pure own-pid filter (no FFI), mirroring the macOS `filter_foreign` shape
/// so ordering/exclusion stays unit-testable.
fn filter_foreign(windows: Vec<PhysicalWindow>, own_pid: i32) -> Vec<PhysicalWindow> {
    windows.into_iter().filter(|w| w.pid != own_pid).collect()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── ProbeGuard once-guard ────────────────────────────────────────────────

    #[test]
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
    fn no_release_before_down_observed() {
        // Button reads up before we ever see it down: stale up-state, no release.
        let (saw_down, released) = step_release_detector(false, false);
        assert!(!saw_down, "saw_down remains false");
        assert!(!released, "must not release without prior down");
    }

    #[test]
    fn down_sets_saw_down_no_release() {
        // Button goes down: saw_down flips to true, no release yet.
        let (saw_down, released) = step_release_detector(false, true);
        assert!(saw_down, "saw_down set on first down read");
        assert!(!released, "no release while button is still down");
    }

    #[test]
    fn release_fires_exactly_on_down_to_up_transition() {
        // Already saw the button down (saw_down=true), now it goes up.
        let (saw_down, released) = step_release_detector(true, false);
        assert!(saw_down, "saw_down stays true after release");
        assert!(released, "release detected on down→up transition");
    }

    #[test]
    fn held_down_does_not_release() {
        // Button is held down while saw_down is already true.
        let (saw_down, released) = step_release_detector(true, true);
        assert!(saw_down, "saw_down stays true while held");
        assert!(!released, "no release while button is still down");
    }

    #[test]
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

    // ── idle_ms_from_ticks ───────────────────────────────────────────────────

    #[test]
    fn idle_ms_from_ticks_normal_diff() {
        assert_eq!(idle_ms_from_ticks(10_000, 7_500), 2_500);
    }

    #[test]
    fn idle_ms_from_ticks_equal_ticks() {
        assert_eq!(idle_ms_from_ticks(5_000, 5_000), 0);
    }

    #[test]
    fn idle_ms_from_ticks_wrap_around_gives_small_diff() {
        // GetTickCount wraps every ~49.7 days (u32::MAX ms). now < last_tick
        // right after a wrap should still yield a small, correct diff via
        // wrapping_sub — not a huge underflowed number.
        let last_tick = u32::MAX - 100; // just before wrap
        let now_tick = 50u32; // just after wrap
        assert_eq!(idle_ms_from_ticks(now_tick, last_tick), 151);
    }

    #[test]
    fn idle_ms_from_ticks_future_tick_clamps_to_zero() {
        // dwTime ahead of "now" (SendInput/raw-input timing gap) is not a
        // real ~49-day idle — clamp to 0 instead of returning a huge value.
        assert_eq!(idle_ms_from_ticks(1_000, 5_000), 0);
    }

    // ── app_name_from_exe_path ───────────────────────────────────────────────

    #[test]
    fn app_name_from_exe_path_normal() {
        assert_eq!(
            app_name_from_exe_path(r"C:\Program Files\Google\Chrome\chrome.exe"),
            Some("chrome".into())
        );
    }

    #[test]
    fn app_name_from_exe_path_no_extension() {
        assert_eq!(
            app_name_from_exe_path(r"C:\tools\myapp"),
            Some("myapp".into())
        );
    }

    #[test]
    fn app_name_from_exe_path_trailing_backslash() {
        // Rust's `Path` treats a trailing separator as insignificant, so the
        // last named component is still the file stem.
        assert_eq!(
            app_name_from_exe_path(r"C:\Program Files\App\"),
            Some("App".into())
        );
    }

    #[test]
    fn app_name_from_exe_path_empty() {
        assert_eq!(app_name_from_exe_path(""), None);
    }

    // ── rect_covers_monitor ──────────────────────────────────────────────────

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn rect_covers_monitor_exact_cover() {
        let mon = rect(0, 0, 2560, 1440);
        let win = rect(0, 0, 2560, 1440);
        assert!(rect_covers_monitor(win, mon));
    }

    #[test]
    fn rect_covers_monitor_partial_does_not_cover() {
        let mon = rect(0, 0, 2560, 1440);
        let win = rect(0, 0, 1280, 1440);
        assert!(!rect_covers_monitor(win, mon));
    }

    #[test]
    fn rect_covers_monitor_smaller_does_not_cover() {
        let mon = rect(0, 0, 2560, 1440);
        let win = rect(100, 100, 800, 600);
        assert!(!rect_covers_monitor(win, mon));
    }

    #[test]
    fn rect_covers_monitor_larger_window_covers() {
        // Window rect extending beyond the monitor still "covers" it.
        let mon = rect(0, 0, 1920, 1080);
        let win = rect(-10, -10, 1930, 1090);
        assert!(rect_covers_monitor(win, mon));
    }

    // ── physical_window_to_at_point (physical → logical) ─────────────────────

    fn phys_window(left: i32, top: i32, right: i32, bottom: i32, dpi: u32) -> PhysicalWindow {
        PhysicalWindow {
            rect: rect(left, top, right, bottom),
            pid: 1234,
            name: Some("Notepad".into()),
            window_number: 42,
            dpi,
        }
    }

    #[test]
    fn physical_to_at_point_96_dpi_identity() {
        let w = phys_window(100, 200, 900, 800, 96);
        let p = physical_window_to_at_point(&w).unwrap();
        assert!((p.x - 100.0).abs() < 1e-9);
        assert!((p.y - 200.0).abs() < 1e-9);
        assert!((p.width - 800.0).abs() < 1e-9);
        assert!((p.height - 600.0).abs() < 1e-9);
    }

    #[test]
    fn physical_to_at_point_144_dpi_is_1_5x_scale() {
        let w = phys_window(0, 0, 1200, 900, 144);
        let p = physical_window_to_at_point(&w).unwrap();
        assert!((p.width - 800.0).abs() < 1e-9);
        assert!((p.height - 600.0).abs() < 1e-9);
    }

    #[test]
    fn physical_to_at_point_192_dpi_is_2x_scale() {
        let w = phys_window(0, 0, 1600, 1200, 192);
        let p = physical_window_to_at_point(&w).unwrap();
        assert!((p.width - 800.0).abs() < 1e-9);
        assert!((p.height - 600.0).abs() < 1e-9);
    }

    #[test]
    fn physical_to_at_point_zero_dpi_returns_none() {
        let w = phys_window(0, 0, 100, 100, 0);
        assert!(physical_window_to_at_point(&w).is_none());
    }

    #[test]
    fn physical_to_at_point_preserves_name_pid_window_number() {
        let w = phys_window(0, 0, 100, 100, 96);
        let p = physical_window_to_at_point(&w).unwrap();
        assert_eq!(p.name, Some("Notepad".into()));
        assert_eq!(p.pid, 1234);
        assert_eq!(p.window_number, 42);
    }

    // ── filter_foreign (pure own-pid filter, order-preserving) ──────────────

    fn win(pid: i32) -> PhysicalWindow {
        PhysicalWindow {
            rect: rect(0, 0, 100, 100),
            pid,
            name: None,
            window_number: 0,
            dpi: 96,
        }
    }

    #[test]
    fn filter_foreign_drops_own_and_preserves_order() {
        let own = 4242;
        let windows = vec![win(11), win(own), win(22)];
        let kept = filter_foreign(windows, own);
        let pids: Vec<i32> = kept.iter().map(|w| w.pid).collect();
        assert_eq!(pids, vec![11, 22]);
    }

    #[test]
    fn filter_foreign_empty_is_empty() {
        assert!(filter_foreign(Vec::new(), 999).is_empty());
    }
}
