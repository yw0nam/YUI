// OS event watcher — real OS polling for active app, idle, fullscreen, camera.
mod os_event_watcher;

// Drag + multi-monitor / DPI.
mod drag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // window.fetch を Rust でルーティング → CORS 回避 + SSE ストリーミング対応.
    .plugin(tauri_plugin_cors_fetch::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Start OS event polling loop (emits `os_event` IPC to webview).
      os_event_watcher::start(app.handle());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      drag::drag_window,
      drag::get_monitors_info,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
