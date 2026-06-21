// OS event watcher — real OS polling for active app, idle, fullscreen, camera.
mod os_event_watcher;

// Drag + multi-monitor / DPI.
mod drag;

// Screen-source enumeration and capture.
mod screenshot;

// Calendar-date-based log rotation.
mod log_rotation;

// Shared import filesystem helpers (sanitize/collision).
mod import_fs;

// Bring-your-own-VRM import (file copy into app-data).
mod vrm_import;

// Bring-your-own-voice import (reference clip copy into app-data).
mod voice_import;

// Click-through toggle (top-level + Windows child HWNDs).
mod passthrough;

use std::path::PathBuf;
use tauri::Manager;
use time::{OffsetDateTime, UtcOffset};

/// Log verbosity: verbose in dev, warnings-and-above in release.
fn level_for(debug: bool) -> log::LevelFilter {
    if debug {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Warn
    }
}

/// Parse a timezone spec: named (`KST`/`UTC`/...) or offset (`+09:00`/`+0900`/`9`/`-5`).
fn parse_tz_offset(s: &str) -> Option<UtcOffset> {
    let s = s.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    if s.is_empty() {
        return None;
    }

    match s.to_ascii_uppercase().as_str() {
        "UTC" | "GMT" | "Z" => return Some(UtcOffset::UTC),
        "KST" | "JST" => return UtcOffset::from_hms(9, 0, 0).ok(),
        "PST" => return UtcOffset::from_hms(-8, 0, 0).ok(),
        "EST" => return UtcOffset::from_hms(-5, 0, 0).ok(),
        _ => {}
    }

    // Offset forms: leading sign optional.
    let (sign, rest) = match s.strip_prefix('-') {
        Some(r) => (-1i8, r),
        None => (1i8, s.strip_prefix('+').unwrap_or(s)),
    };

    let (h, m): (i8, i8) = if let Some((hh, mm)) = rest.split_once(':') {
        // HH:MM
        (hh.parse().ok()?, mm.parse().ok()?)
    } else if rest.len() == 4 && rest.chars().all(|c| c.is_ascii_digit()) {
        // HHMM
        (rest[..2].parse().ok()?, rest[2..].parse().ok()?)
    } else {
        // integer hours
        (rest.parse().ok()?, 0)
    };

    UtcOffset::from_hms(sign * h, sign * m, 0).ok()
}

/// Extract `KEY=value` from dotenv-style text (skips blanks/comments, strips quotes). Last match wins.
fn dotenv_value(contents: &str, key: &str) -> Option<String> {
    let mut found = None;
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
                found = Some(v.to_string());
            }
        }
    }
    found
}

/// Resolve the log timestamp offset: process env → dev `.env.local` → UTC default.
/// `YUI_LOG_TZ` is canonical; `VITE_YUI_LOG_TZ` is accepted as an alias (for shared `.env.local`).
fn resolve_log_offset() -> UtcOffset {
    if let Some(off) = std::env::var("YUI_LOG_TZ")
        .or_else(|_| std::env::var("VITE_YUI_LOG_TZ"))
        .ok()
        .and_then(|s| parse_tz_offset(&s))
    {
        return off;
    }

    if cfg!(debug_assertions) {
        let env_local = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env.local");
        if let Ok(contents) = std::fs::read_to_string(&env_local) {
            if let Some(off) = dotenv_value(&contents, "YUI_LOG_TZ")
                .or_else(|| dotenv_value(&contents, "VITE_YUI_LOG_TZ"))
                .and_then(|s| parse_tz_offset(&s))
            {
                return off;
            }
        }
    }

    UtcOffset::UTC
}

/// Deterministic log line: `[YYYY-MM-DD HH:MM:SS][LEVEL] message` — no target, no caller location.
fn format_log_line(
    offset: UtcOffset,
    now_utc: OffsetDateTime,
    level: log::Level,
    message: &str,
) -> String {
    let t = now_utc.to_offset(offset);
    format!(
        "[{:04}-{:02}-{:02} {:02}:{:02}:{:02}][{}] {}",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        level,
        message
    )
}

/// Third-party HTTP crates that flood debug logs; silence to Warn.
fn noisy_targets() -> &'static [(&'static str, log::LevelFilter)] {
    &[
        ("reqwest", log::LevelFilter::Warn),
        ("hyper_util", log::LevelFilter::Warn),
        ("hyper", log::LevelFilter::Warn),
    ]
}

fn date_rotating_target(dir: PathBuf, base: String, offset: UtcOffset) -> tauri_plugin_log::Target {
    let writer = log_rotation::DateRotatingFile::new(dir, base, offset);
    let dispatch = tauri_plugin_log::fern::Dispatch::new().chain(
        tauri_plugin_log::fern::Output::writer(Box::new(writer), "\n"),
    );
    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Dispatch(dispatch))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // window.fetch를 Rust로 라우팅 → CORS 우회 + SSE 스트리밍 지원(plugin-http는 스트리밍 불가).
        .plugin(tauri_plugin_cors_fetch::init())
        // OS 파일 피커 — bring-your-own VRM import.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let log_offset = resolve_log_offset();
            let mut builder = tauri_plugin_log::Builder::new()
                .level(level_for(cfg!(debug_assertions)))
                .format(move |out, message, record| {
                    out.finish(format_args!(
                        "{}",
                        format_log_line(
                            log_offset,
                            OffsetDateTime::now_utc(),
                            record.level(),
                            &message.to_string(),
                        )
                    ));
                });

            let base = app.package_info().name.clone();

            if cfg!(debug_assertions) {
                // Dev: write logs into the repo's <worktree>/logs/ for easy `tail -f logs/*.log`.
                let dev_logs = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../logs");
                builder = builder
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ))
                    .target(date_rotating_target(dev_logs, base.clone(), log_offset));
            } else {
                // Release: standard OS log dir (~/Library/Logs/com.yui.desktop/ on macOS).
                builder = builder.target(date_rotating_target(
                    app.path().app_log_dir()?,
                    base,
                    log_offset,
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
            os_event_watcher::list_windows,
            screenshot::list_screen_sources,
            screenshot::capture_screen,
            vrm_import::import_vrm_file,
            vrm_import::remove_user_vrm,
            voice_import::import_voice_file,
            voice_import::remove_user_voice,
            passthrough::set_click_through,
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
        let names: std::collections::HashSet<&str> = targets.iter().map(|(n, _)| *n).collect();
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
