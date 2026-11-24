//! Docks a pet window into its own settings window. On macOS she becomes a native child window
//! at normal level, so AppKit moves her with the settings window in the same frame and other apps
//! can cover both; elsewhere there is no link, and the webview follows the settings window itself.
//!
//! A linked window unlinks before the tray hides it, since attaching a child window shows it and a
//! parent orders a hidden child back in (the pattern of Electron's `NativeWindowMac::Show`/`Hide`).

use tauri::{Emitter, Manager, Runtime, WebviewWindow, Window, WindowEvent};

/// Heard by every pet window, with the closing settings window's label.
const CLOSED_EVENT: &str = "yui://settings-stage-closed";

/// The settings window a pet window docks into: `main` → `settings`, `pet-<id>` → `settings-<id>`.
fn parent_label(child: &str) -> Option<String> {
    if child == "main" {
        return Some("settings".into());
    }
    child
        .strip_prefix("pet-")
        .filter(|id| !id.is_empty())
        .map(|id| format!("settings-{id}"))
}

/// The pet window a settings window docks, the inverse of `parent_label`.
fn child_label(parent: &str) -> Option<String> {
    if parent == "settings" {
        return Some("main".into());
    }
    parent
        .strip_prefix("settings-")
        .filter(|id| !id.is_empty())
        .map(|id| format!("pet-{id}"))
}

#[cfg(target_os = "macos")]
mod macos {
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    use objc2_app_kit::{NSNormalWindowLevel, NSWindow, NSWindowLevel, NSWindowOrderingMode};
    use tauri::{Runtime, WebviewWindow};

    use crate::threads_window::with_ns_window;

    /// Each docked window's level from before its first link, by label, while its session lasts.
    static LEVELS: Mutex<BTreeMap<String, NSWindowLevel>> = Mutex::new(BTreeMap::new());

    /// Makes `child` a child window of `parent` at normal level; a window already linked stays as it is.
    pub fn link<R: Runtime>(
        child: &WebviewWindow<R>,
        parent: WebviewWindow<R>,
    ) -> Result<(), String> {
        let label = child.label().to_string();
        with_ns_window(child, move |child_ns| {
            let parent_ptr = parent.ns_window().map_err(|e| e.to_string())?;
            // SAFETY: on the main thread, `parent_ptr` is the live NSWindow* of `parent`.
            let parent_ns = unsafe { &*(parent_ptr as *const NSWindow) };
            if child_ns
                .parentWindow()
                .is_some_and(|p| std::ptr::eq(&*p, parent_ns))
            {
                return Ok(());
            }
            LEVELS
                .lock()
                .map_err(|e| e.to_string())?
                .entry(label)
                .or_insert_with(|| child_ns.level());
            // SAFETY: both are live windows on the main thread, and a settings window is never a
            // child of its pet window, so no cycle forms.
            unsafe { parent_ns.addChildWindow_ordered(child_ns, NSWindowOrderingMode::Above) };
            child_ns.setLevel(NSNormalWindowLevel);
            Ok(())
        })
    }

    /// Removes `child` from its parent's child windows, where it stays; `end` also ends its
    /// session and gives back the level it had before the first link.
    pub fn unlink<R: Runtime>(child: &WebviewWindow<R>, end: bool) -> Result<(), String> {
        let label = child.label().to_string();
        with_ns_window(child, move |child_ns| {
            if let Some(parent) = child_ns.parentWindow() {
                parent.removeChildWindow(child_ns);
            }
            if end {
                if let Some(level) = LEVELS.lock().map_err(|e| e.to_string())?.remove(&label) {
                    child_ns.setLevel(level);
                }
            }
            Ok(())
        })
    }

    /// Whether a session links the window labelled `label`, shown or hidden.
    pub fn in_session(label: &str) -> bool {
        LEVELS.lock().is_ok_and(|levels| levels.contains_key(label))
    }
}

/// Links this pet window into its own settings window. Returns whether a native link is in
/// effect: always false off macOS. Refuses any other window, and a settings window that is not open.
#[tauri::command]
pub fn window_dock_attach<R: Runtime>(window: WebviewWindow<R>) -> Result<bool, String> {
    let parent_label = parent_label(window.label())
        .ok_or_else(|| format!("{} docks into no settings window", window.label()))?;
    let parent = window
        .get_webview_window(&parent_label)
        .ok_or_else(|| format!("no window {parent_label}"))?;
    #[cfg(target_os = "macos")]
    {
        macos::link(&window, parent)?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = parent;
        Ok(false)
    }
}

/// Unlinks this window from its settings window and gives back its level; it stays where it is.
#[tauri::command]
pub fn window_dock_detach<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::unlink(&window, true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(())
    }
}

/// A settings window's close request unlinks its pet window before AppKit closes the parent,
/// then tells the pet windows which settings window closes.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { .. } = event else {
        return;
    };
    let Some(child_label) = child_label(window.label()) else {
        return;
    };
    #[cfg(target_os = "macos")]
    if let Some(child) = window.get_webview_window(&child_label) {
        if let Err(error) = macos::unlink(&child, true) {
            log::warn!("window_dock_detach_failed window={child_label} error={error}");
        }
    }
    if let Err(error) = window.app_handle().emit(CLOSED_EVENT, window.label()) {
        log::warn!("settings_stage_closed_emit_failed window={child_label} error={error}");
    }
}

/// Unlinks a docked window before it hides, keeping its session.
pub(crate) fn unlink_for_hide<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    if macos::in_session(window.label()) {
        if let Err(error) = macos::unlink(window, false) {
            log::warn!(
                "window_dock_hide_unlink_failed window={} error={error}",
                window.label()
            );
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Links a window shown again back into its settings window while its session lasts.
pub(crate) fn relink_after_show<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    if macos::in_session(window.label()) {
        let parent =
            parent_label(window.label()).and_then(|label| window.get_webview_window(&label));
        if let Some(parent) = parent {
            if let Err(error) = macos::link(window, parent) {
                log::warn!(
                    "window_dock_show_relink_failed window={} error={error}",
                    window.label()
                );
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pet_window_docks_into_its_own_settings_window() {
        for (child, parent) in [
            ("main", Some("settings")),
            ("pet-mio", Some("settings-mio")),
        ] {
            assert_eq!(parent_label(child).as_deref(), parent);
            assert_eq!(parent.and_then(child_label).as_deref(), Some(child));
        }
    }

    #[test]
    fn other_windows_dock_nowhere() {
        for label in ["settings", "message", "threads", "pet-"] {
            assert_eq!(parent_label(label), None);
        }
        for label in ["main", "message-mio", "settings-"] {
            assert_eq!(child_label(label), None);
        }
    }
}
