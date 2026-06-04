// OS event watcher stub (Rust 측 OS API 접근 전담). 실제 emit 로직은 M1.
// 근거: docs/event-dispatcher.md §1/§3.3/§10.
mod os_event_watcher;

// Drag + multi-monitor / DPI (Issue #9, F2 M1).
mod drag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
