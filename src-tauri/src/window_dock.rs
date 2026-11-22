//! Runs a closure on a window's NSWindow on the main thread (macOS), for the native window work
//! that Tauri's window API does not cover.

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use std::sync::mpsc;

    use objc2::MainThreadMarker;
    use objc2_app_kit::NSWindow;
    use tauri::{Runtime, WebviewWindow};

    /// Runs `f` on the main thread with the window's NSWindow, blocking until it returns.
    pub(crate) fn with_ns_window<R: Runtime, T: Send + 'static>(
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
}
