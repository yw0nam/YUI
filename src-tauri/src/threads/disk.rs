use super::model::Thread;
use super::store::RETENTION_MS;
use crate::log_rotation::{parse_dated_name, DateRotatingFile};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use time::UtcOffset;

pub struct Disk(DateRotatingFile);
impl Disk {
    pub fn new(dir: PathBuf, offset: UtcOffset) -> Self {
        Self(DateRotatingFile::new(
            dir,
            "threads".into(),
            "jsonl",
            offset,
        ))
    }

    pub fn append(&mut self, thread: &Thread) -> io::Result<()> {
        let mut line = serde_json::to_vec(thread)?;
        line.push(b'\n');
        self.0.write_all(&line)
    }
}

pub fn replay(dir: &Path, now: u64) -> Vec<Thread> {
    let files = match fs::read_dir(dir) {
        Ok(files) => files,
        Err(error) => {
            if error.kind() != io::ErrorKind::NotFound {
                log::warn!("threads_replay_failed error={error}");
            }
            return vec![];
        }
    };
    let mut files: Vec<_> = files
        .flatten()
        .filter_map(|entry| {
            if !entry.file_type().ok()?.is_file() {
                return None;
            }
            let name = entry.file_name();
            let name = name.to_str()?;
            if name.len() != 24 {
                return None;
            }
            let date = parse_dated_name(name, "threads", "jsonl")?;
            Some((date, entry.path()))
        })
        .collect();
    files.sort_by_key(|(date, _)| *date);
    let mut threads = HashMap::new();
    for (_, path) in files {
        let file = match fs::File::open(&path) {
            Ok(file) => file,
            Err(error) => {
                log::warn!(
                    "threads_replay_failed path={} error={error}",
                    path.display()
                );
                continue;
            }
        };
        for line in io::BufReader::new(file).lines() {
            let Ok(line) = line else {
                continue;
            };
            if let Ok(thread) = serde_json::from_str::<Thread>(&line) {
                threads.insert(thread.id.clone(), thread);
            }
        }
    }
    threads
        .into_values()
        .filter(|t| t.updated_at >= now.saturating_sub(RETENTION_MS))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::threads::model::tests::body;
    use serde_json::json;
    use std::fs;

    struct ReplayLog(std::sync::Mutex<Vec<String>>);
    static LOG: ReplayLog = ReplayLog(std::sync::Mutex::new(Vec::new()));
    impl log::Log for ReplayLog {
        fn enabled(&self, _: &log::Metadata<'_>) -> bool {
            true
        }
        fn log(&self, record: &log::Record<'_>) {
            self.0.lock().unwrap().push(record.args().to_string());
        }
        fn flush(&self) {}
    }

    #[test]
    fn replay_logs_read_errors_but_not_malformed_json() {
        log::set_logger(&LOG).unwrap();
        log::set_max_level(log::LevelFilter::Warn);
        let dir =
            std::env::temp_dir().join(format!("yui_threads_read_error_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("threads_2026-10-29.jsonl");
        fs::write(&path, b"not json\n\xff\n").unwrap();
        assert_eq!(replay(&dir, 1), vec![]);
        let messages: Vec<_> = LOG
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|line| line.contains(path.to_str().unwrap()))
            .cloned()
            .collect();
        assert_eq!(
            messages,
            vec![format!(
                "threads_replay_failed path={} error=stream did not contain valid UTF-8",
                path.display()
            )]
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replay_orders_files_skips_malformed_and_expires_old_threads() {
        let dir = std::env::temp_dir().join(format!("yui_threads_replay_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut t = body();
        t["id"] = json!("t");
        t["created_at"] = json!(1);
        t["updated_at"] = json!(1_209_600_001u64);
        t["entries"] = json!([]);
        let old = {
            let mut old = t.clone();
            old["id"] = json!("expired");
            old["updated_at"] = json!(0);
            old
        };
        fs::write(
            dir.join("threads_2026-10-28.jsonl"),
            format!("{t}\n{old}\nmalformed\n"),
        )
        .unwrap();
        t["title"] = json!("Latest");
        fs::write(dir.join("threads_2026-10-29.jsonl"), format!("{t}\n{{\n")).unwrap();
        fs::write(dir.join("threads_bad-date.jsonl"), format!("{old}\n")).unwrap();
        let mut unpadded = t.clone();
        unpadded["id"] = json!("unpadded");
        fs::write(dir.join("threads_2026-1-2.jsonl"), format!("{unpadded}\n")).unwrap();
        let loaded = replay(&dir, 1_209_600_001);
        assert_eq!(loaded.len(), 1, "only the unexpired Thread replays");
        assert_eq!(loaded[0].title, "Latest");
        assert_eq!(loaded[0].ask.as_ref().unwrap().ask_id, "a");
        fs::remove_dir_all(dir).unwrap();
    }
}
