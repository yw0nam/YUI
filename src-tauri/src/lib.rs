// OS event watcher stub (Rust 측 OS API 접근 전담).
mod os_event_watcher;

// Drag + multi-monitor / DPI.
mod drag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // window.fetch를 Rust로 라우팅 → CORS 우회 + SSE 스트리밍 지원(plugin-http는 스트리밍 불가).
    .plugin(tauri_plugin_cors_fetch::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      drag::drag_window,
      drag::get_monitors_info,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
