//! The Threads window at the native level: its window number, and an order-front that takes no focus.

use tauri::{AppHandle, Runtime};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::{Manager, WebviewWindow};

#[cfg(any(target_os = "macos", target_os = "windows"))]
const LABEL: &str = "threads";

/// The Threads window's native window number, `None` when it does not exist or has none yet.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn window_number<R: Runtime>(app: &AppHandle<R>) -> Option<u32> {
    let window = app.get_webview_window(LABEL)?;
    #[cfg(target_os = "macos")]
    {
        with_ns_window(&window, |ns| Ok(ns.windowNumber()))
            .ok()
            .filter(|n| *n > 0)
            .map(|n| n as u32)
    }
    #[cfg(target_os = "windows")]
    {
        window.hwnd().ok().map(|hwnd| hwnd.0 as usize as u32)
    }
}

/// Orders the Threads window to the front without making it key or activating YUI.
///
/// Tauri's `show()` is not used: on macOS it is `makeKeyAndOrderFront`
/// (`tao-0.35.3/src/platform_impl/macos/window.rs:668-672`), which takes key status.
#[tauri::command]
pub fn threads_order_front<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let window = app
            .get_webview_window(LABEL)
            .ok_or_else(|| format!("no window {LABEL}"))?;
        order_front(&window)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn order_front<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    with_ns_window(window, |ns| {
        ns.orderFrontRegardless();
        Ok(())
    })
}

#[cfg(target_os = "windows")]
fn order_front<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SW_SHOWNOACTIVATE,
        },
    };

    let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
    // SAFETY: `hwnd` is the live top-level window of `window`.
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())
    }
}

/// Runs `f` on the main thread with the window's NSWindow, blocking until it returns.
#[cfg(target_os = "macos")]
pub(crate) fn with_ns_window<R: Runtime, T: Send + 'static>(
    window: &WebviewWindow<R>,
    f: impl FnOnce(&objc2_app_kit::NSWindow) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSWindow;
    use std::sync::mpsc;

    let run = |w: &WebviewWindow<R>| -> Result<T, String> {
        let ptr = w.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: on the main thread (checked or hopped to below), `ptr` is the live
        // NSWindow* of `w`, valid for the duration of this call.
        let ns = unsafe { &*(ptr as *const NSWindow) };
        f(ns)
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
