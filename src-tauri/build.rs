/// Every app command; Tauri then checks each one against the capabilities.
const COMMANDS: &[&str] = &[
    "drag_window",
    "list_windows",
    "list_screen_sources",
    "capture_screen",
    "capture_screen_at",
    "import_vrm_file",
    "remove_user_vrm",
    "import_voice_file",
    "remove_user_voice",
    "rename_user_voice",
    "import_card_file",
    "retain_card_thumbnail",
    "pick_preset_photo",
    "remove_card_thumbnail",
    "export_card_file",
    "set_click_through",
    "start_agent_ingress",
    "sync_preset_ids",
    "avatar_rpc_response",
    "threads_snapshot",
    "thread_answer",
    "append_turn_record",
    "set_frame_logical",
    "window_dock_attach",
    "window_dock_detach",
    "plugin_host_snapshot",
    "plugin_host_add_local",
    "plugin_host_enable",
    "plugin_host_disable",
    "plugin_host_retry",
    "plugin_host_log_tail",
    "plugin_host_reveal_log",
    "plugin_host_catalog",
    "plugin_host_install",
    "plugin_host_remove",
    "plugin_host_call",
    "plugin_host_cancel",
    "plugin_host_skill",
];

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    if let Err(error) =
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
    {
        panic!("{error:#}");
    }
}
