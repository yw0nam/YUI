//! Windows OS polling stubs — cfg-gated compile-only.
//!
//! TODO: Implement using:
//!   - `GetLastInputInfo` for OS-wide idle (winapi crate or raw FFI)
//!   - `GetForegroundWindow` + `GetWindowTextW` for active window/title
//!   - `SHQueryUserNotificationState` for fullscreen detection
//!   - MF_CAPTURE_ENGINE for camera (best-effort)
//!
//! All functions must not panic; degrade gracefully per R11.

use super::{emit_os_event, epoch_ms, OsEventData, OsEventPayload};
use std::{thread, time::Duration};
use tauri::AppHandle;

const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Spawns a no-op background polling thread.
/// Replace with real implementation when Windows support is prioritised.
pub fn start_polling(app: AppHandle) {
    thread::Builder::new()
        .name("os_event_watcher_win".into())
        .spawn(move || loop {
            // Emit idle tick with None (source error: not yet implemented).
            let _ = emit_os_event(
                &app,
                OsEventPayload {
                    event_name: "os_idle_tick".into(),
                    ts: epoch_ms(),
                    data: OsEventData { os_idle_ms: None, ..Default::default() },
                },
            );
            thread::sleep(POLL_INTERVAL);
        })
        .expect("failed to spawn os_event_watcher thread");
}
