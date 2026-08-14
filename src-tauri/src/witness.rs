//! Witness log — transition-only record of frontmost app and idle state.
//!
//! Records land in `<app_data_dir>/witness/activity_YYYY-MM-DD.jsonl`, one JSON
//! object per line, date-rotated with the shared 14-day retention. Observation
//! must never break the app: every fs and serialisation error is swallowed.

use crate::log_rotation::DateRotatingFile;
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use time::{OffsetDateTime, UtcOffset};

/// Idle time at or above which the OS is considered idle.
pub const IDLE_THRESHOLD_MS: u64 = 5 * 60 * 1000;

/// Window titles are truncated to this many characters.
pub const MAX_TITLE_CHARS: usize = 256;

/// Caps a window title at `MAX_TITLE_CHARS`, the bound shared by the witness
/// log and the IPC frontmost payload.
pub(crate) fn cap_title(title: Option<String>) -> Option<String> {
    title.map(|t| t.chars().take(MAX_TITLE_CHARS).collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordKind {
    AppChange,
    IdleStart,
    IdleEnd,
}

/// One JSONL line: a single observed transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WitnessRecord {
    /// ISO 8601 local time with offset.
    pub ts: String,
    #[serde(rename = "type")]
    pub kind: RecordKind,
    pub app: Option<String>,
    pub window_title: Option<String>,
}

/// One poll reading: the frontmost window plus OS idle time.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Sample {
    pub app: Option<String>,
    pub window_title: Option<String>,
    pub idle_ms: Option<u64>,
}

/// Pure, FFI-free transition detector: holds the last observed state and
/// returns the records a new sample crosses (0–2, idle transition first).
#[derive(Debug, Default)]
pub struct TransitionDetector {
    app: Option<String>,
    window_title: Option<String>,
    idle: bool,
}

impl TransitionDetector {
    pub fn step(&mut self, sample: &Sample, ts: &str) -> Vec<WitnessRecord> {
        let mut out = Vec::new();
        let record = |kind| WitnessRecord {
            ts: ts.to_string(),
            kind,
            app: sample.app.clone(),
            window_title: cap_title(sample.window_title.clone()),
        };

        // An unreadable idle time carries the previous state forward.
        let idle = match sample.idle_ms {
            Some(ms) => ms >= IDLE_THRESHOLD_MS,
            None => self.idle,
        };
        if idle != self.idle {
            out.push(record(if idle {
                RecordKind::IdleStart
            } else {
                RecordKind::IdleEnd
            }));
        }
        self.idle = idle;

        if sample.app != self.app || sample.window_title != self.window_title {
            out.push(record(RecordKind::AppChange));
            self.app = sample.app.clone();
            self.window_title = sample.window_title.clone();
        }

        out
    }
}

/// Renders `now_utc` in `offset` as `YYYY-MM-DDTHH:MM:SS±HH:MM`.
pub fn format_ts(now_utc: OffsetDateTime, offset: UtcOffset) -> String {
    let t = now_utc.to_offset(offset);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{:+03}:{:02}",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        offset.whole_hours(),
        offset.minutes_past_hour().unsigned_abs(),
    )
}

/// Detects transitions and appends them to the dated witness file.
pub struct WitnessLog {
    file: DateRotatingFile,
    detector: TransitionDetector,
    offset: UtcOffset,
}

impl WitnessLog {
    pub fn new(dir: PathBuf, offset: UtcOffset) -> Self {
        Self {
            file: DateRotatingFile::new(dir, "activity".into(), "jsonl", offset),
            detector: TransitionDetector::default(),
            offset,
        }
    }

    pub fn observe(&mut self, sample: Sample) {
        let ts = format_ts(OffsetDateTime::now_utc(), self.offset);
        for record in self.detector.step(&sample, &ts) {
            if let Ok(line) = serde_json::to_string(&record) {
                let _ = self.file.write_all(format!("{line}\n").as_bytes());
            }
        }
    }
}

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
        let out = d.step(
            &sample(Some("Safari"), Some("Start Page"), Some(1000)),
            "T2",
        );
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
    fn first_sample_while_idle_emits_idle_start() {
        // A start while the user is away must still pair: the later idle_end
        // needs a matching idle_start.
        let mut d = TransitionDetector::default();
        let out = d.step(&sample(None, None, Some(IDLE_THRESHOLD_MS)), "T1");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::IdleStart);
        let out = d.step(&sample(None, None, Some(0)), "T2");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, RecordKind::IdleEnd);
    }

    #[test]
    fn first_sample_while_active_emits_no_idle_record() {
        let mut d = TransitionDetector::default();
        let out = d.step(&sample(None, None, Some(0)), "T1");
        assert!(out.is_empty(), "an active first sample is not a transition");
    }

    // ── window title cap ─────────────────────────────────────────────────────

    #[test]
    fn record_truncates_an_overlong_window_title() {
        let mut d = TransitionDetector::default();
        let long = "a".repeat(MAX_TEXT_CHARS + 44);
        let out = d.step(&sample(Some("Safari"), Some(&long), Some(0)), "T1");
        assert_eq!(
            out[0].window_title.as_deref().map(str::len),
            Some(MAX_TEXT_CHARS)
        );
    }

    #[test]
    fn record_truncates_a_multibyte_title_on_char_boundaries() {
        let mut d = TransitionDetector::default();
        let long = "한".repeat(MAX_TEXT_CHARS + 44);
        let out = d.step(&sample(Some("Safari"), Some(&long), Some(0)), "T1");
        let title = out[0].window_title.as_deref().unwrap();
        assert_eq!(title.chars().count(), MAX_TEXT_CHARS);
        assert!(title.chars().all(|c| c == '한'));
    }

    #[test]
    fn record_keeps_a_short_title_verbatim() {
        let mut d = TransitionDetector::default();
        let out = d.step(&sample(Some("Safari"), Some("Start Page"), Some(0)), "T1");
        assert_eq!(out[0].window_title.as_deref(), Some("Start Page"));
    }

    // ── app name cap ─────────────────────────────────────────────────────────

    #[test]
    fn record_truncates_an_overlong_app_name() {
        let mut d = TransitionDetector::default();
        let long = "한".repeat(MAX_TEXT_CHARS + 44);
        let out = d.step(&sample(Some(&long), Some("Start Page"), Some(0)), "T1");
        let app = out[0].app.as_deref().unwrap();
        assert_eq!(app.chars().count(), MAX_TEXT_CHARS);
        assert!(app.chars().all(|c| c == '한'));
    }

    #[test]
    fn record_keeps_a_short_app_name_verbatim() {
        let mut d = TransitionDetector::default();
        let out = d.step(&sample(Some("Safari"), None, Some(0)), "T1");
        assert_eq!(out[0].app.as_deref(), Some("Safari"));
    }

    // ── cap_text helper ──────────────────────────────────────────────────────

    #[test]
    fn cap_text_truncates_an_overlong_multibyte_value_to_max_chars() {
        let long = "한".repeat(MAX_TEXT_CHARS + 44);
        let capped = cap_text(Some(long)).unwrap();
        assert_eq!(capped.chars().count(), MAX_TEXT_CHARS);
        assert!(capped.chars().all(|c| c == '한'));
    }

    #[test]
    fn cap_text_passes_a_short_value_through_verbatim() {
        assert_eq!(
            cap_text(Some("Start Page".into())).as_deref(),
            Some("Start Page")
        );
    }

    #[test]
    fn cap_text_passes_none_through() {
        assert_eq!(cap_text(None), None);
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
