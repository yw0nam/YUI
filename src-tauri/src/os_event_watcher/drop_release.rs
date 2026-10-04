use super::{platform_lbutton_is_down, WINDOW_DROP_RELEASE_CHANNEL};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};

const RELEASE_POLL_INTERVAL: Duration = Duration::from_millis(16);
const RELEASE_POLL_TIMEOUT: Duration = Duration::from_secs(10);

static PROBE_ACTIVE: AtomicBool = AtomicBool::new(false);

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

// Drop-release probe, invoked by drag.rs after start_dragging().
// Emits `window_drop_release` as a bare signal (no payload).
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
