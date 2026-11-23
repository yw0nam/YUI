//! Links a docked window to its owner window as a native child window (macOS), so AppKit
//! moves the docked window with it in the same frame. On Windows the link makes it an owned
//! window (above its owner, hidden while the owner is minimised) that does not move with it, so
//! the webview still moves the window itself; elsewhere there is no link.
//!
//! A window links on each dock and unlinks before each hide and each head drag: a hidden child
//! can be ordered back in by its parent, and attaching a child window shows it (the same pattern
//! as Electron's `NativeWindowMac::Show`/`Hide`).

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use std::sync::mpsc;

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSWindow, NSWindowOrderingMode};
    use tauri::{Manager, Runtime, WebviewWindow};

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

/// SPIKE #2045 (never merged): the owner link on Windows, set at runtime with `GWLP_HWNDPARENT`.
#[cfg(target_os = "windows")]
pub(crate) mod win32 {
    use serde::Serialize;
    use tauri::{Manager, Runtime, WebviewWindow};
    use windows::Win32::{
        Foundation::{GetLastError, SetLastError, HWND, WIN32_ERROR},
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetTopWindow, GetWindow, GetWindowLongPtrW,
            GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetWindowLongPtrW, SetWindowPos,
            ShowWindow, GWLP_HWNDPARENT, GWL_EXSTYLE, GW_HWNDNEXT, GW_OWNER, HWND_TOP,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_TOPMOST,
        },
    };

    fn hwnd_of<R: Runtime>(window: &WebviewWindow<R>) -> Result<HWND, String> {
        Ok(HWND(window.hwnd().map_err(|e| e.to_string())?.0))
    }

    /// Makes `owner` the owner of the top-level `window` (null: unowned), as Electron's
    /// `NativeWindowViews::SetParentWindow` does: a visible window is hidden and shown again so the
    /// shell re-reads its taskbar button, shown without activation so settings keeps focus.
    fn set_owner(window: HWND, owner: HWND) -> Result<(), String> {
        // SAFETY: both handles are live top-level windows of this process, and the call runs on
        // their UI thread (a blocking command runs inside WebView2's WebResourceRequested handler).
        unsafe {
            if GetWindowLongPtrW(window, GWLP_HWNDPARENT) == owner.0 as isize {
                return Ok(());
            }
            SetLastError(WIN32_ERROR(0));
            let previous = SetWindowLongPtrW(window, GWLP_HWNDPARENT, owner.0 as isize);
            let error = GetLastError();
            if previous == 0 && error.0 != 0 {
                return Err(format!(
                    "SetWindowLongPtrW(GWLP_HWNDPARENT) failed: {}",
                    error.0
                ));
            }
            if IsWindowVisible(window).as_bool() {
                let _ = ShowWindow(window, SW_HIDE);
                let _ = ShowWindow(window, SW_SHOWNOACTIVATE);
            }
            // SetWindowLongPtr changes take effect at the next SetWindowPos (cached window data).
            SetWindowPos(
                window,
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

    pub fn attach<R: Runtime>(
        window: WebviewWindow<R>,
        parent_label: String,
    ) -> Result<bool, String> {
        let parent = window
            .get_webview_window(&parent_label)
            .ok_or_else(|| format!("no window {parent_label}"))?;
        set_owner(hwnd_of(&window)?, hwnd_of(&parent)?)?;
        // An owned window does not move with its owner.
        Ok(false)
    }

    pub fn detach<R: Runtime>(window: WebviewWindow<R>) -> Result<bool, String> {
        set_owner(hwnd_of(&window)?, HWND::default())?;
        Ok(false)
    }

    /// Releases every window a closing settings window owns: Windows destroys an owned window with
    /// its owner, so a pet docked to settings would otherwise close with it.
    pub fn release_owned_on_close<R: Runtime>(
        window: &tauri::Window<R>,
        event: &tauri::WindowEvent,
    ) {
        if !matches!(event, tauri::WindowEvent::CloseRequested { .. })
            || !window.label().starts_with("settings")
        {
            return;
        }
        let Ok(owner) = window.hwnd().map(|h| HWND(h.0)) else {
            return;
        };
        for (label, owned) in window.webview_windows() {
            let Ok(h) = hwnd_of(&owned) else { continue };
            // SAFETY: read-only query on a live window handle.
            if unsafe { GetWindow(h, GW_OWNER) }.ok() == Some(owner) {
                let result = set_owner(h, HWND::default());
                log::warn!(
                    "spike_dock_release_on_close owner={} window={label} result={result:?}",
                    window.label()
                );
            }
        }
    }

    /// Where the calling window and its would-be owner sit among the visible top-level windows.
    #[derive(Serialize)]
    pub struct ZOrder {
        owner_is_parent: bool,
        /// Front-to-back index among visible top-level windows; None when not visible.
        pet_index: Option<usize>,
        parent_index: Option<usize>,
        foreground_index: Option<usize>,
        pet_above_parent: Option<bool>,
        foreground_is_yui: bool,
        foreground_is_pet: bool,
        foreground_is_parent: bool,
        pet_topmost: bool,
        pet_visible: bool,
        parent_minimized: bool,
    }

    pub fn zorder<R: Runtime>(
        window: WebviewWindow<R>,
        parent_label: String,
    ) -> Result<ZOrder, String> {
        let parent = window
            .get_webview_window(&parent_label)
            .ok_or_else(|| format!("no window {parent_label}"))?;
        let (pet, settings) = (hwnd_of(&window)?, hwnd_of(&parent)?);
        // SAFETY: read-only queries on window handles; a stale handle only fails the query.
        unsafe {
            let foreground = GetForegroundWindow();
            let (mut pet_index, mut parent_index, mut foreground_index) = (None, None, None);
            let mut index = 0;
            let mut next = GetTopWindow(None).ok();
            while let Some(h) = next {
                if IsWindowVisible(h).as_bool() {
                    if h == pet {
                        pet_index = Some(index);
                    }
                    if h == settings {
                        parent_index = Some(index);
                    }
                    if h == foreground {
                        foreground_index = Some(index);
                    }
                    index += 1;
                }
                next = GetWindow(h, GW_HWNDNEXT).ok();
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(foreground, Some(&mut pid));
            Ok(ZOrder {
                owner_is_parent: GetWindow(pet, GW_OWNER).ok() == Some(settings),
                pet_index,
                parent_index,
                foreground_index,
                pet_above_parent: pet_index.zip(parent_index).map(|(p, s)| p < s),
                foreground_is_yui: pid == std::process::id(),
                foreground_is_pet: foreground == pet,
                foreground_is_parent: foreground == settings,
                pet_topmost: GetWindowLongPtrW(pet, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0,
                pet_visible: IsWindowVisible(pet).as_bool(),
                parent_minimized: IsIconic(settings).as_bool(),
            })
        }
    }
}

/// Makes this window a child (macOS) or an owned window (Windows) of the window labelled
/// `parent_label`. Returns whether the OS moves it with that window: true only on macOS.
#[tauri::command]
pub fn window_dock_attach<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    parent_label: String,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos::attach(window, parent_label)
    }
    #[cfg(target_os = "windows")]
    {
        win32::attach(window, parent_label)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, parent_label);
        Ok(false)
    }
}

/// Removes this window from its parent's child windows (macOS) or its owner (Windows); it stays where it is.
/// Returns whether a native link is still in effect: always false.
#[tauri::command]
pub fn window_dock_detach<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos::detach(window)
    }
    #[cfg(target_os = "windows")]
    {
        win32::detach(window)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        Ok(false)
    }
}

/// SPIKE #2045 (never merged): this window's owner and z-order against the window labelled
/// `parent_label` and the foreground window. None off Windows.
#[tauri::command]
pub fn spike_dock_zorder<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    parent_label: String,
) -> Result<Option<serde_json::Value>, String> {
    #[cfg(target_os = "windows")]
    {
        let order = win32::zorder(window, parent_label)?;
        serde_json::to_value(order)
            .map(Some)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, parent_label);
        Ok(None)
    }
}
