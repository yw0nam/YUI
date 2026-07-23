//! Drag + multi-monitor / DPI support.
//!
//! # Responsibilities
//! - `drag_window` command: called from webview `pointerdown` to initiate OS-native window drag.
//!
//! # Multi-monitor / DPI correctness
//! Tauri v2 `Window::start_dragging()` is OS-native and moves the window in *physical* pixels
//! internally. The OS DWM / Quartz Compositor handles the physical-to-logical remapping when
//! the window crosses a monitor boundary; we do NOT need to manually reposition after a drag.
//!
//! The `onScaleChanged` JS listener (see `src/drag.ts`) is the seam for reacting to DPI changes
//! (e.g., snapping or re-centering).
//!
//! # Dispatcher seam
//! Click/pet-gesture events on the character region belong to the dispatcher. `src/drag.ts` emits
//! a placeholder `"__yui_gesture_stub"` custom event at the drag-start site as the gesture seam.

use tauri::{command, Runtime, WebviewWindow};
// `Manager` is only needed for `app_handle()` in the drop-release probe below,
// which is itself gated to macOS/Windows. Gate the import to match, so other
// platforms don't see it as unused under `-D warnings`.
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::Manager;

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// Start OS-native window drag.
///
/// Called from the webview on `pointerdown` inside the drag region. Uses
/// `WebviewWindow::start_dragging` which delegates to the OS window manager —
/// no manual position tracking needed.
///
/// Returns `Ok(())` on success; the window follows the pointer until the
/// primary mouse button is released, then stays at the new position.
#[command]
pub fn drag_window<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    window.start_dragging().map_err(|e| {
        log::warn!("start_dragging_failed error={e}");
        e.to_string()
    })?;

    // Detect the drop release and emit `window_drop_release`. The poll thread
    // is needed because the OS-modal drag loop does not surface a release to
    // the webview.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    crate::os_event_watcher::spawn_drop_release_probe(window.app_handle().clone());

    Ok(())
}
