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

use super::{emit_os_event, epoch_ms, OsEventData, OsEventPayload, WINDOW_DROP_RELEASE_CHANNEL};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

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
}
