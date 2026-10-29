use super::model::Thread;
use std::path::Path;

pub fn replay(_dir: &Path, _now: u64) -> Vec<Thread> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::threads::model::tests::body;
    use serde_json::json;
    use std::fs;

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
        let loaded = replay(&dir, 1_209_600_001);
        assert_eq!(loaded.len(), 1, "only the unexpired Thread replays");
        assert_eq!(loaded[0].title, "Latest");
        assert_eq!(loaded[0].ask.as_ref().unwrap().ask_id, "a");
        fs::remove_dir_all(dir).unwrap();
    }
}
