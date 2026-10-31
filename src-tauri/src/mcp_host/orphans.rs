//! The process groups of this host's running servers, recorded in `<app_data>/plugins/groups.json`.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// The process groups of this host's running servers, mirrored to `groups.json`.
pub struct Registry {
    path: Option<PathBuf>,
    pgids: Mutex<BTreeSet<u32>>,
}

impl Registry {
    /// Kills the groups a previous run left behind, then starts an empty record.
    pub fn open(path: Option<PathBuf>) -> Arc<Self> {
        Arc::new(Self {
            path,
            pgids: Mutex::default(),
        })
    }

    /// Records a spawned server's group.
    pub fn group(self: &Arc<Self>, pgid: Option<u32>) -> Group {
        Group {
            pgid,
            registry: self.clone(),
        }
    }
}

/// One server's process group; killing it also drops it from the record.
#[derive(Clone)]
pub struct Group {
    pgid: Option<u32>,
    registry: Arc<Registry>,
}

impl Group {
    pub fn kill(&self) {}
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::test_support::{eventually, gone, read_json, temp_dir};
    use super::*;
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    use serde_json::json;
    use std::io::BufRead;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    fn record(pgids: &str) -> PathBuf {
        let path = temp_dir().join("groups.json");
        std::fs::write(&path, pgids).unwrap();
        path
    }

    #[tokio::test]
    async fn open_kills_a_recorded_group_whose_leader_is_gone() {
        let mut leader = Command::new("sh")
            .args(["-c", "sleep 300 >/dev/null & echo $!"])
            .process_group(0)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        std::io::BufReader::new(leader.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let orphan: i32 = line.trim().parse().unwrap();
        leader.wait().unwrap();
        let path = record(&format!(r#"{{"pgids":[{}]}}"#, leader.id()));
        Registry::open(Some(path.clone()));
        let killed = eventually(|| gone(orphan)).await;
        let _ = kill(Pid::from_raw(orphan), Signal::SIGKILL);
        assert!(killed, "orphan {orphan} still runs");
        assert_eq!(read_json(&path), json!({"pgids": []}));
    }

    #[tokio::test]
    async fn open_leaves_a_group_whose_leader_runs() {
        let mut leader = Command::new("sleep")
            .arg("300")
            .process_group(0)
            .spawn()
            .unwrap();
        let path = record(&format!(r#"{{"pgids":[{}]}}"#, leader.id()));
        Registry::open(Some(path.clone()));
        tokio::time::sleep(Duration::from_millis(200)).await;
        let alive = leader.try_wait().unwrap().is_none();
        let _ = leader.kill();
        leader.wait().unwrap();
        assert!(alive, "the running leader was killed");
        assert_eq!(read_json(&path), json!({"pgids": []}));
    }

    #[test]
    fn open_empties_a_record_of_a_gone_group_or_an_invalid_file() {
        let mut ended = Command::new("true").spawn().unwrap();
        ended.wait().unwrap();
        for text in [
            format!(r#"{{"pgids":[{}]}}"#, ended.id()),
            "not json".into(),
        ] {
            let path = record(&text);
            Registry::open(Some(path.clone()));
            assert_eq!(read_json(&path), json!({"pgids": []}), "from {text}");
        }
    }
}
