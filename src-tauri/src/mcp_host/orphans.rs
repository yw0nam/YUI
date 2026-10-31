//! The process groups of this host's running servers, recorded in `<app_data>/plugins/groups.json`
//! so the next start can kill what a server started when the app was killed without its exit hook.
//!
//! The kernel never hands out a pid that is still a live process-group id, so a recorded group
//! whose leader is gone and that still has members belongs to this app.

use super::store;
use super::tree::Tree;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Serialize, Deserialize)]
struct Record {
    pgids: Vec<u32>,
}

/// The process groups of this host's running servers, mirrored to `groups.json`.
pub struct ProcessGroups {
    path: Option<PathBuf>,
    pgids: Mutex<BTreeSet<u32>>,
}

impl ProcessGroups {
    /// Kills the groups a previous run left behind, then starts an empty record.
    /// `None` (no app data dir, or Windows) records nothing and sweeps nothing.
    pub fn open(path: Option<PathBuf>) -> Arc<Self> {
        if let Some(path) = &path {
            #[cfg(unix)]
            sweep(path);
            write(path, &BTreeSet::new());
        }
        Arc::new(Self {
            path,
            pgids: Mutex::default(),
        })
    }

    /// Records a spawned server's group, when its tree has one.
    pub fn group(self: &Arc<Self>, tree: Tree) -> ProcessGroup {
        if let Some(pgid) = tree.group_id() {
            self.change(|pgids| pgids.insert(pgid));
        }
        ProcessGroup {
            tree,
            groups: self.clone(),
        }
    }

    /// Applies `edit` and writes the whole set when it changed, under the lock.
    fn change(&self, edit: impl FnOnce(&mut BTreeSet<u32>) -> bool) {
        let mut pgids = self.pgids.lock().unwrap_or_else(|e| e.into_inner());
        if let (true, Some(path)) = (edit(&mut pgids), &self.path) {
            write(path, &pgids);
        }
    }
}

/// One server's process group; killing it also drops it from the record.
#[derive(Clone)]
pub struct ProcessGroup {
    tree: Tree,
    groups: Arc<ProcessGroups>,
}

impl ProcessGroup {
    /// Kills the tree, then forgets its group.
    pub fn kill(&self) {
        self.tree.kill();
        if let Some(pgid) = self.tree.group_id() {
            self.groups.change(|pgids| pgids.remove(&pgid));
        }
    }
}

fn write(path: &Path, pgids: &BTreeSet<u32>) {
    let record = Record {
        pgids: pgids.iter().copied().collect(),
    };
    if let Err(e) = store::save(path, &record) {
        log::warn!("mcp_host_groups_write_failed error={e}");
    }
}

/// Kills each recorded group whose leader is gone and that still has members.
#[cfg(unix)]
fn sweep(path: &Path) {
    use nix::errno::Errno;
    use nix::sys::signal::{kill, killpg, Signal};
    use nix::unistd::{getpgrp, Pid};
    let own = getpgrp();
    for pgid in recorded(path) {
        // pgid 0 and 1 and this process's own group are never signalled.
        let Ok(raw @ 2..) = i32::try_from(pgid) else {
            continue;
        };
        let group = Pid::from_raw(raw);
        if group == own {
            continue;
        }
        if matches!(kill(group, None), Ok(()) | Err(Errno::EPERM)) {
            log::info!("mcp_host_orphan_group_skipped pgid={pgid} reason=leader_alive");
            continue;
        }
        match killpg(group, Signal::SIGKILL) {
            Ok(()) => log::info!("mcp_host_orphan_group_killed pgid={pgid}"),
            Err(Errno::ESRCH) => {}
            Err(e) => log::warn!("mcp_host_orphan_group_kill.failed pgid={pgid} error={e}"),
        }
    }
}

/// The recorded pgids; a missing file is none, an unreadable or invalid one is logged and none.
#[cfg(unix)]
fn recorded(path: &Path) -> Vec<u32> {
    let text = match std::fs::read_to_string(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        text => text.map_err(|e| e.to_string()),
    };
    text.and_then(|t| serde_json::from_str::<Record>(&t).map_err(|e| e.to_string()))
        .map(|record| record.pgids)
        .unwrap_or_else(|e| {
            log::warn!("mcp_host_groups_unreadable error={e}");
            Vec::new()
        })
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
        ProcessGroups::open(Some(path.clone()));
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
        ProcessGroups::open(Some(path.clone()));
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
            ProcessGroups::open(Some(path.clone()));
            assert_eq!(read_json(&path), json!({"pgids": []}), "from {text}");
        }
    }
}
