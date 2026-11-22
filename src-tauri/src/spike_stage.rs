//! SPIKE #1971 (never merged): native reads and knobs for the one-stage-window probe.
//! `spike_native(action)`: "state" | "deactivate" | "level:<n>" | "hide_app" | "unhide_quiet".

#[tauri::command]
pub fn spike_native<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    action: String,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        crate::window_dock::macos::with_ns_window(&window, move |ns, _| {
            // SAFETY: main thread (with_ns_window), NSApplication is a live singleton.
            let app: *mut AnyObject = unsafe { msg_send![class!(NSApplication), sharedApplication] };
            unsafe {
                if action == "deactivate" {
                    let _: () = msg_send![app, deactivate];
                } else if action == "hide_app" {
                    let _: () = msg_send![app, hide: std::ptr::null::<AnyObject>()];
                } else if action == "unhide_quiet" {
                    let _: () = msg_send![app, unhideWithoutActivation];
                } else if let Some(n) = action.strip_prefix("level:") {
                    ns.setLevel(n.parse::<isize>().map_err(|e| e.to_string())?);
                }
                let active: bool = msg_send![app, isActive];
                let policy: isize = msg_send![app, activationPolicy];
                Ok(serde_json::json!({
                    "level": ns.level(),
                    "is_key": ns.isKeyWindow(),
                    "is_main": ns.isMainWindow(),
                    "can_become_key": ns.canBecomeKeyWindow(),
                    "ignores_mouse": ns.ignoresMouseEvents(),
                    "app_active": active,
                    "activation_policy": policy,
                }))
            }
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, action);
        Err("macOS only".into())
    }
}
