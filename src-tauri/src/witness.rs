// Witness log — transition-only record of frontmost app and idle state.

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use time::{Date, Month, OffsetDateTime, Time, UtcOffset};

    fn utc(y: i32, m: u8, d: u8, h: u8, min: u8, s: u8) -> OffsetDateTime {
        let date = Date::from_calendar_date(y, Month::try_from(m).unwrap(), d).unwrap();
        let time = Time::from_hms(h, min, s).unwrap();
        OffsetDateTime::new_utc(date, time)
    }

    fn sample(app: Option<&str>, title: Option<&str>, idle_ms: Option<u64>) -> Sample {
        Sample {
            app: app.map(str::to_string),
            window_title: title.map(str::to_string),
            idle_ms,
        }
    }

    // ── record serialisation ─────────────────────────────────────────────────

    #[test]
    fn app_change_record_serialises_spec_shape() {
        let r = WitnessRecord {
            ts: "2026-08-12T14:30:05+09:00".into(),
            kind: RecordKind::AppChange,
            app: Some("Safari".into()),
            window_title: Some("Start Page".into()),
        };
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            json!({
                "ts": "2026-08-12T14:30:05+09:00",
                "type": "app_change",
                "app": "Safari",
                "window_title": "Start Page",
            })
        );
    }

    #[test]
    fn idle_record_types_are_snake_case() {
        let start = WitnessRecord {
            ts: "2026-08-12T14:30:05+09:00".into(),
            kind: RecordKind::IdleStart,
            app: None,
            window_title: None,
        };
        let end = WitnessRecord {
            kind: RecordKind::IdleEnd,
            ..start.clone()
        };
        assert_eq!(serde_json::to_value(&start).unwrap()["type"], "idle_start");
        assert_eq!(serde_json::to_value(&end).unwrap()["type"], "idle_end");
    }

    #[test]
    fn record_keeps_null_app_fields() {
        let r = WitnessRecord {
            ts: "2026-08-12T14:30:05+09:00".into(),
            kind: RecordKind::IdleStart,
            app: None,
            window_title: None,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert!(v["app"].is_null());
        assert!(v["window_title"].is_null());
    }

    // ── timestamp formatting ─────────────────────────────────────────────────

    #[test]
    fn format_ts_renders_local_time_with_positive_offset() {
        let offset = UtcOffset::from_hms(9, 0, 0).unwrap();
        assert_eq!(
            format_ts(utc(2026, 8, 12, 5, 30, 5), offset),
            "2026-08-12T14:30:05+09:00"
        );
    }

    #[test]
    fn format_ts_renders_negative_offset() {
        let offset = UtcOffset::from_hms(-5, -30, 0).unwrap();
        assert_eq!(
            format_ts(utc(2026, 8, 12, 5, 0, 0), offset),
            "2026-08-11T23:30:00-05:30"
        );
    }

    #[test]
    fn format_ts_renders_utc_as_zero_offset() {
        assert_eq!(
            format_ts(utc(2026, 1, 2, 3, 4, 5), UtcOffset::UTC),
            "2026-01-02T03:04:05+00:00"
        );
    }

    // ── transition detection ─────────────────────────────────────────────────

    #[test]
    fn idle_threshold_is_five_minutes() {
        assert_eq!(IDLE_THRESHOLD_MS, 300_000);
    }

    #[test]
    fn first_frontmost_emits_app_change() {
        let mut d = TransitionDetector::default();
        let out = d.step(&sample(Some("Safari"), Some("Start Page"), Some(0)), "T");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::AppChange);
        assert_eq!(out[0].app.as_deref(), Some("Safari"));
        assert_eq!(out[0].window_title.as_deref(), Some("Start Page"));
        assert_eq!(out[0].ts, "T");
    }

    #[test]
    fn unchanged_sample_emits_nothing() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), Some("Start Page"), Some(0)), "T1");
        let out = d.step(&sample(Some("Safari"), Some("Start Page"), Some(1000)), "T2");
        assert!(out.is_empty(), "steady state must emit no record");
    }

    #[test]
    fn app_switch_emits_app_change() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), Some("Start Page"), Some(0)), "T1");
        let out = d.step(&sample(Some("Xcode"), Some("main.rs"), Some(0)), "T2");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::AppChange);
        assert_eq!(out[0].app.as_deref(), Some("Xcode"));
    }

    #[test]
    fn title_change_within_same_app_emits_app_change() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), Some("Start Page"), Some(0)), "T1");
        let out = d.step(&sample(Some("Safari"), Some("Docs"), Some(0)), "T2");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::AppChange);
        assert_eq!(out[0].window_title.as_deref(), Some("Docs"));
    }

    #[test]
    fn empty_frontmost_emits_nothing() {
        let mut d = TransitionDetector::default();
        let out = d.step(&sample(None, None, Some(0)), "T1");
        assert!(out.is_empty(), "no frontmost window is not a transition");
    }

    #[test]
    fn idle_start_emitted_at_threshold_with_current_frontmost() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), Some("Start Page"), Some(0)), "T1");
        let out = d.step(
            &sample(Some("Safari"), Some("Start Page"), Some(IDLE_THRESHOLD_MS)),
            "T2",
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::IdleStart);
        assert_eq!(out[0].app.as_deref(), Some("Safari"));
        assert_eq!(out[0].window_title.as_deref(), Some("Start Page"));
    }

    #[test]
    fn staying_idle_emits_nothing() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), None, Some(0)), "T1");
        d.step(&sample(Some("Safari"), None, Some(IDLE_THRESHOLD_MS)), "T2");
        let out = d.step(&sample(Some("Safari"), None, Some(900_000)), "T3");
        assert!(out.is_empty(), "still idle must emit no record");
    }

    #[test]
    fn idle_end_emitted_when_input_returns() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), None, Some(0)), "T1");
        d.step(&sample(Some("Safari"), None, Some(IDLE_THRESHOLD_MS)), "T2");
        let out = d.step(&sample(Some("Safari"), None, Some(0)), "T3");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::IdleEnd);
    }

    #[test]
    fn first_sample_while_idle_emits_no_idle_start() {
        let mut d = TransitionDetector::default();
        let out = d.step(&sample(None, None, Some(IDLE_THRESHOLD_MS)), "T1");
        assert!(out.is_empty(), "no prior state means no idle transition");
        // The idle state is still seeded: returning input is an idle_end.
        let out = d.step(&sample(None, None, Some(0)), "T2");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::IdleEnd);
    }

    #[test]
    fn unknown_idle_preserves_previous_state() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), None, Some(0)), "T1");
        let out = d.step(&sample(Some("Safari"), None, None), "T2");
        assert!(out.is_empty(), "unreadable idle must emit no record");
        let out = d.step(&sample(Some("Safari"), None, Some(IDLE_THRESHOLD_MS)), "T3");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::IdleStart);
    }

    #[test]
    fn idle_end_and_app_switch_in_one_tick_emit_both() {
        let mut d = TransitionDetector::default();
        d.step(&sample(Some("Safari"), None, Some(0)), "T1");
        d.step(&sample(Some("Safari"), None, Some(IDLE_THRESHOLD_MS)), "T2");
        let out = d.step(&sample(Some("Xcode"), Some("main.rs"), Some(0)), "T3");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].kind, RecordKind::IdleEnd);
        assert_eq!(out[0].app.as_deref(), Some("Xcode"));
        assert_eq!(out[1].kind, RecordKind::AppChange);
        assert_eq!(out[1].app.as_deref(), Some("Xcode"));
    }

    // ── writer ───────────────────────────────────────────────────────────────

    fn scratch(tag: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("yui_witness_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn log_appends_jsonl_lines_to_dated_file() {
        let dir = scratch("append");
        let mut log = WitnessLog::new(dir.clone(), UtcOffset::UTC);
        log.observe(sample(Some("Safari"), Some("Start Page"), Some(0)));
        log.observe(sample(Some("Xcode"), Some("main.rs"), Some(0)));

        let today = OffsetDateTime::now_utc().date();
        let path = dir.join(format!(
            "activity_{:04}-{:02}-{:02}.jsonl",
            today.year(),
            u8::from(today.month()),
            today.day()
        ));
        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["type"], "app_change");
        assert_eq!(first["app"], "Safari");
        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["app"], "Xcode");
    }

    #[test]
    fn log_writes_nothing_without_transitions() {
        let dir = scratch("quiet");
        let mut log = WitnessLog::new(dir.clone(), UtcOffset::UTC);
        log.observe(sample(None, None, Some(0)));
        assert!(!dir.exists(), "a quiet observation must not create files");
    }
}
