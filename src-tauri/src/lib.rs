// OS event watcher — real OS polling for active app, idle, fullscreen, camera.
mod os_event_watcher;

// Drag + multi-monitor / DPI.
mod drag;

// Screen-source enumeration and capture (issue #20).
mod screenshot;

/// Log verbosity: verbose in dev, warnings-and-above in release.
fn level_for(debug: bool) -> log::LevelFilter {
  if debug { log::LevelFilter::Debug } else { log::LevelFilter::Warn }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // window.fetch를 Rust로 라우팅 → CORS 우회 + SSE 스트리밍 지원(plugin-http는 스트리밍 불가).
    .plugin(tauri_plugin_cors_fetch::init())
    .setup(|app| {
      let mut builder = tauri_plugin_log::Builder::new()
        .level(level_for(cfg!(debug_assertions)))
        .max_file_size(10_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .target(tauri_plugin_log::Target::new(
          tauri_plugin_log::TargetKind::Webview,
        ));

      if cfg!(debug_assertions) {
        // Dev: write logs into the repo's <worktree>/logs/ for easy `tail -f logs/*.log`.
        let dev_logs = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../logs");
        builder = builder
          .target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Stdout,
          ))
          .target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Folder {
              path: dev_logs,
              file_name: None,
            },
          ));
      } else {
        // Release: standard OS log dir (~/Library/Logs/com.yui.desktop/ on macOS).
        builder = builder.target(tauri_plugin_log::Target::new(
          tauri_plugin_log::TargetKind::LogDir { file_name: None },
        ));
      }

      app.handle().plugin(builder.build())?;

      // Start OS event polling loop (emits `os_event` IPC to webview).
      os_event_watcher::start(app.handle());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      drag::drag_window,
      drag::get_monitors_info,
      screenshot::list_screen_sources,
      screenshot::capture_screen,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn level_for_dev_is_debug() {
    assert_eq!(level_for(true), log::LevelFilter::Debug);
  }

  #[test]
  fn level_for_release_is_warn() {
    assert_eq!(level_for(false), log::LevelFilter::Warn);
  }
}
