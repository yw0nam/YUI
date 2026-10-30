//! Links a docked window to its owner window as a native child window (macOS), so AppKit
//! moves the docked window with it in the same frame. Elsewhere there is no such link, and
//! the webview moves the window itself.
//!
//! A window links on each dock and unlinks before each hide and each head drag: a hidden child
//! can be ordered back in by its parent, and attaching a child window shows it (the same pattern
//! as Electron's `NativeWindowMac::Show`/`Hide`).

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::mpsc;

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSWindow, NSWindowOrderingMode};
    use tauri::{Manager, Runtime, WebviewWindow};

    /// Runs `f` on the main thread with the window's NSWindow, blocking until it returns.
    fn with_ns_window<R: Runtime, T: Send + 'static>(
        window: &WebviewWindow<R>,
        f: impl FnOnce(&NSWindow, &WebviewWindow<R>) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let run = |w: &WebviewWindow<R>| -> Result<T, String> {
            let ptr = w.ns_window().map_err(|e| e.to_string())?;
            // SAFETY: on the main thread (checked or hopped to below), `ptr` is the live
            // NSWindow* of `w`, valid for the duration of this call.
            let ns = unsafe { &*(ptr as *const NSWindow) };
            f(ns, w)
        };
        if MainThreadMarker::new().is_some() {
            return run(window);
        }
        let (tx, rx) = mpsc::channel();
        let on_main = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(run(&on_main));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }

    pub fn attach<R: Runtime>(
        window: WebviewWindow<R>,
        parent_label: String,
    ) -> Result<bool, String> {
        with_ns_window(&window, move |child, w| {
            let parent = w
                .get_webview_window(&parent_label)
                .ok_or_else(|| format!("no window {parent_label}"))?;
            let parent_ptr = parent.ns_window().map_err(|e| e.to_string())?;
            // SAFETY: on the main thread, `parent_ptr` is the live NSWindow* of `parent`.
            let parent_ns = unsafe { &*(parent_ptr as *const NSWindow) };
            let linked = child
                .parentWindow()
                .is_some_and(|p| std::ptr::eq(&*p, parent_ns));
            if !linked {
                // Attaching resets the child's window level; the docked window keeps its always-on-top one.
                let level = child.level();
                // SAFETY: both are live windows on the main thread, and the window is never a
                // parent of its owner, so no cycle forms.
                unsafe { parent_ns.addChildWindow_ordered(child, NSWindowOrderingMode::Above) };
                child.setLevel(level);
            }
            Ok(true)
        })
    }

    pub fn detach<R: Runtime>(window: WebviewWindow<R>) -> Result<bool, String> {
        with_ns_window(&window, |child, _| {
            if let Some(parent) = child.parentWindow() {
                parent.removeChildWindow(child);
            }
            Ok(false)
        })
    }
}

/// Makes this window a child of the window labelled `parent_label`, so it moves with it.
/// Returns whether the native link is in effect: always false off macOS.
#[tauri::command]
pub fn window_dock_attach<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    parent_label: String,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos::attach(window, parent_label)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, parent_label);
        Ok(false)
    }
}

/// Removes this window from its parent's child windows; it stays where it is.
/// Returns whether a native link is still in effect: always false.
#[tauri::command]
pub fn window_dock_detach<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos::detach(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(false)
    }
}
