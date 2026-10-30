use super::model::Thread;
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
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            if error.kind() != io::ErrorKind::NotFound {
                log::warn!("threads_replay_failed path={} error={error}", dir.display());
            }
            return vec![];
        }
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            // The shared parser accepts variable-width dates; replay requires the canonical filename width.
            let name = entry
                .file_name()
                .into_string()
                .ok()
                .filter(|name| name.len() == 24)?;
            Some((parse_dated_name(&name, "threads", "jsonl")?, entry.path()))
        })
        .collect();
    files.sort();
    let mut threads = HashMap::new();
    for (_, path) in files {
        let read = fs::File::open(&path).and_then(|file| {
            for line in io::BufReader::new(file).lines() {
                if let Ok(thread) = serde_json::from_str::<Thread>(&line?) {
                    threads.insert(thread.id.clone(), thread);
                }
            }
            Ok(())
        });
        if let Err(error) = read {
            log::warn!(
                "threads_replay_failed path={} error={error}",
                path.display()
            );
        }
    }
    threads
        .into_values()
        .filter(|t| {
            t.updated_at
                >= now.saturating_sub(crate::log_rotation::RETENTION.whole_milliseconds() as u64)
        })
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
        let base = t.clone();
        let with = |id: &str, updated_at: u64| {
            let mut thread = base.clone();
            thread["id"] = json!(id);
            thread["updated_at"] = json!(updated_at);
            thread
        };
        let (old, after) = (with("expired", 0), with("after-malformed", 1_209_600_001));
        fs::write(
            dir.join("threads_2026-10-28.jsonl"),
            format!("{t}\n{old}\nmalformed\n{after}\n"),
        )
        .unwrap();
        t["title"] = json!("Latest");
        fs::write(dir.join("threads_2026-10-29.jsonl"), format!("{t}\n{{\n")).unwrap();
        let (bad, unpadded) = (
            with("bad-date", 1_209_600_001),
            with("unpadded", 1_209_600_001),
        );
        fs::write(dir.join("threads_2026-13-01.jsonl"), format!("{bad}\n")).unwrap();
        fs::write(dir.join("threads_2026-1-2.jsonl"), format!("{unpadded}\n")).unwrap();
        let mut loaded = replay(&dir, 1_209_600_001);
        loaded.sort_by(|a, b| a.id.cmp(&b.id));
        let ids: Vec<_> = loaded.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            ["after-malformed", "t"],
            "only canonical files' unexpired Threads replay"
        );
        assert_eq!(loaded[1].title, "Latest");
        assert_eq!(loaded[1].ask.as_ref().unwrap().ask_id, "a");
        fs::remove_dir_all(dir).unwrap();
    }
}
