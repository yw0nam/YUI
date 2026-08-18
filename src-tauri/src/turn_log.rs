//! Turn-record JSONL append — a minimal Tauri command that appends an opaque
//! JSON line (built on the TS side) to the day's `turns_YYYY-MM-DD.jsonl` file,
//! sharing the app's dated-log directory and rotation/retention.
//!
//! One line per completed backend turn or per skipped screen-source fire; the
//! long-horizon analysis source for speak-rate/suppression measurement. TS
//! calls this fire-and-forget — a failed append surfaces only as an `Err`
//! string, which the caller swallows and logs at debug.

use crate::log_rotation::DateRotatingFile;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use time::UtcOffset;

/// Shared append target: `turns_YYYY-MM-DD.jsonl` in the resolved log directory.
pub struct TurnRecordLog(Mutex<DateRotatingFile>);

impl TurnRecordLog {
    pub fn new(dir: PathBuf, offset: UtcOffset) -> Self {
        Self(Mutex::new(DateRotatingFile::new(
            dir,
            "turns".into(),
            "jsonl",
            offset,
        )))
    }

    fn append_line(&self, line: &str) -> std::io::Result<()> {
        let mut file = self.0.lock().unwrap_or_else(|e| e.into_inner());
        writeln!(file, "{line}")
    }
}

#[tauri::command]
pub fn append_turn_record(state: State<TurnRecordLog>, line: String) -> Result<(), String> {
    state.append_line(&line).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::OffsetDateTime;

    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("yui_turnlog_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    fn todays_path(dir: &std::path::Path) -> PathBuf {
        let today = OffsetDateTime::now_utc().date();
        dir.join(format!(
            "turns_{:04}-{:02}-{:02}.jsonl",
            today.year(),
            u8::from(today.month()),
            today.day()
        ))
    }

    #[test]
    fn append_line_creates_the_dated_turns_file() {
        let dir = scratch("creates");
        let log = TurnRecordLog::new(dir.clone(), UtcOffset::UTC);
        log.append_line(r#"{"type":"turn"}"#).unwrap();

        let content = std::fs::read_to_string(todays_path(&dir)).unwrap();
        assert_eq!(content, "{\"type\":\"turn\"}\n");
    }

    #[test]
    fn append_line_appends_multiple_lines_to_the_same_day() {
        let dir = scratch("appends");
        let log = TurnRecordLog::new(dir.clone(), UtcOffset::UTC);
        log.append_line(r#"{"a":1}"#).unwrap();
        log.append_line(r#"{"a":2}"#).unwrap();

        let content = std::fs::read_to_string(todays_path(&dir)).unwrap();
        assert_eq!(content, "{\"a\":1}\n{\"a\":2}\n");
    }

    #[test]
    fn append_line_writes_nothing_to_a_sibling_directory() {
        let dir = scratch("isolated");
        let log = TurnRecordLog::new(dir.clone(), UtcOffset::UTC);
        log.append_line(r#"{"a":1}"#).unwrap();
        assert!(!dir.join("YUI.log").exists());
    }
}
