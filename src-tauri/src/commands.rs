//! The IPC command table the webview can invoke.

use tauri::ipc::Invoke;

pub fn handler() -> impl Fn(Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        #[cfg(desktop)]
        crate::drag::drag_window,
        crate::os_event_watcher::list_windows,
        #[cfg(desktop)]
        crate::screenshot::list_screen_sources,
        #[cfg(desktop)]
        crate::screenshot::capture_screen,
        crate::vrm_import::import_vrm_file,
        crate::vrm_import::remove_user_vrm,
        crate::voice_import::import_voice_file,
        crate::voice_import::remove_user_voice,
        crate::voice_import::rename_user_voice,
        #[cfg(desktop)]
        crate::passthrough::set_click_through,
        crate::agent_ingress::start_agent_ingress,
        crate::agent_ingress::avatar_rpc_response,
        crate::turn_log::append_turn_record,
        crate::window_frame::set_frame_logical,
    ]
}
