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

/// Third-party HTTP crates that flood debug logs; silence to Warn.
fn noisy_targets() -> &'static [(&'static str, log::LevelFilter)] {
  &[
    ("reqwest", log::LevelFilter::Warn),
    ("hyper_util", log::LevelFilter::Warn),
    ("hyper", log::LevelFilter::Warn),
  ]
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
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne);

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

      for (target, level) in noisy_targets() {
        builder = builder.level_for(*target, *level);
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

  // ── noisy_targets: third-party crates that flood debug logs ──────────────────

  #[test]
  fn noisy_targets_contains_reqwest() {
    let targets = noisy_targets();
    let found = targets.iter().any(|(name, _)| *name == "reqwest");
    assert!(found, "noisy_targets must include 'reqwest'");
  }

  #[test]
  fn noisy_targets_all_entries_are_warn() {
    let targets = noisy_targets();
    for (name, level) in targets {
      assert_eq!(
        *level,
        log::LevelFilter::Warn,
        "entry '{}' must be Warn, got {:?}",
        name,
        level,
      );
    }
  }

  #[test]
  fn noisy_targets_includes_required_set() {
    let targets = noisy_targets();
    let names: std::collections::HashSet<&str> =
      targets.iter().map(|(n, _)| *n).collect();
    for required in &["reqwest", "hyper_util", "hyper"] {
      assert!(
        names.contains(required),
        "noisy_targets must include '{}'; got {:?}",
        required,
        names,
      );
    }
  }

  // ── parse_tz_offset: named + offset forms ────────────────────────────────────

  #[test]
  fn parse_tz_offset_named_kst_case_insensitive() {
    let want = UtcOffset::from_hms(9, 0, 0).unwrap();
    assert_eq!(parse_tz_offset("KST"), Some(want));
    assert_eq!(parse_tz_offset("kst"), Some(want));
  }

  #[test]
  fn parse_tz_offset_offset_colon_form() {
    assert_eq!(
      parse_tz_offset("+09:00"),
      Some(UtcOffset::from_hms(9, 0, 0).unwrap())
    );
  }

  #[test]
  fn parse_tz_offset_offset_four_digit_form() {
    assert_eq!(
      parse_tz_offset("+0900"),
      Some(UtcOffset::from_hms(9, 0, 0).unwrap())
    );
  }

  #[test]
  fn parse_tz_offset_integer_hours() {
    assert_eq!(
      parse_tz_offset("9"),
      Some(UtcOffset::from_hms(9, 0, 0).unwrap())
    );
    assert_eq!(
      parse_tz_offset("-5"),
      Some(UtcOffset::from_hms(-5, 0, 0).unwrap())
    );
  }

  #[test]
  fn parse_tz_offset_negative_with_minutes() {
    assert_eq!(
      parse_tz_offset("-05:30"),
      Some(UtcOffset::from_hms(-5, -30, 0).unwrap())
    );
  }

  #[test]
  fn parse_tz_offset_utc_aliases() {
    let utc = UtcOffset::UTC;
    assert_eq!(parse_tz_offset("UTC"), Some(utc));
    assert_eq!(parse_tz_offset("Z"), Some(utc));
  }

  #[test]
  fn parse_tz_offset_invalid_is_none() {
    assert_eq!(parse_tz_offset(""), None);
    assert_eq!(parse_tz_offset("garbage"), None);
  }

  // ── dotenv_value: KEY=value extraction ───────────────────────────────────────

  #[test]
  fn dotenv_value_extracts_key_ignoring_comments_and_decoy() {
    let contents = "\
# a comment
VITE_YUI_CHAT_KEY=abc

YUI_LOG_TZ_OTHER=x
# YUI_LOG_TZ=commented
YUI_LOG_TZ=\"KST\"
";
    assert_eq!(
      dotenv_value(contents, "YUI_LOG_TZ"),
      Some("KST".to_string())
    );
    assert_eq!(
      dotenv_value(contents, "YUI_LOG_TZ_OTHER"),
      Some("x".to_string())
    );
    assert_eq!(dotenv_value(contents, "MISSING"), None);
  }

  // ── format_log_line: deterministic, tz-shifted, location-free ────────────────

  #[test]
  fn format_log_line_shifts_to_kst_and_drops_location() {
    use time::{Date, Month, Time};

    let offset = UtcOffset::from_hms(9, 0, 0).unwrap();
    // Fixed 2026-06-07 07:59:20 UTC.
    let now_utc = Date::from_calendar_date(2026, Month::June, 7)
      .unwrap()
      .with_time(Time::from_hms(7, 59, 20).unwrap())
      .assume_utc();
    let message = "[YUI][quick-ui] 추론 강도 변경 {\"effort\":\"high\"}";

    let line = format_log_line(offset, now_utc, log::Level::Info, message);

    assert_eq!(
      line,
      "[2026-06-07 16:59:20][INFO] [YUI][quick-ui] 추론 강도 변경 {\"effort\":\"high\"}"
    );
    assert!(!line.contains("@http"), "must not contain caller location");
    assert!(!line.contains("webview:"), "must not contain target");
  }
}
