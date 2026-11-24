//! Watches herdr servers and signals agent state changes (unix only).

pub mod forward;
pub mod machines;
pub mod signal;
pub mod socket;
pub mod subscribe;

use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const SIGNALS_METHOD: &str = "notifications/io.github.yw0nam.yui/signals";

/// Delivers one signal group's params to the MCP peer.
pub type Notify = Arc<dyn Fn(serde_json::Value) + Send + Sync>;

/// One sender task fed by a channel, so notifications go out in the order they were produced.
pub fn notifier(peer: rmcp::Peer<rmcp::RoleServer>) -> Notify {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    tokio::spawn(async move {
        while let Some(params) = rx.recv().await {
            let notification = rmcp::model::ServerNotification::CustomNotification(
                rmcp::model::CustomNotification::new(SIGNALS_METHOD, Some(params)),
            );
            if let Err(e) = peer.send_notification(notification).await {
                eprintln!("herdr_signal_failed error={}", one_line(&e.to_string()));
            }
        }
    });
    Arc::new(move |params| {
        let _ = tx.send(params);
    })
}

/// This process's private socket directory under `root`.
pub fn socket_dir(root: &Path) -> PathBuf {
    root.join(format!("yui-herdr-{}", std::process::id()))
}

/// One watch task per server: local and every enabled saved machine.
pub fn spawn(locate: fn() -> Option<PathBuf>, notify: Notify) {
    tokio::spawn(async move {
        let root = std::env::temp_dir();
        sweep_stale(&root);
        let watched = machines::watched(locate).await;
        let dir = socket_dir(&root);
        let ssh = crate::locate::find_ssh();
        let mut remote_ok = true;
        if watched
            .iter()
            .any(|w| matches!(w.endpoint, machines::Endpoint::Remote { .. }))
        {
            if let Err(e) = prepare_dir(&dir) {
                eprintln!(
                    "herdr_watch_failed machine=local error=socket dir: {}",
                    one_line(&e.to_string())
                );
                remote_ok = false;
            }
        }
        for w in watched {
            if !remote_ok && matches!(w.endpoint, machines::Endpoint::Remote { .. }) {
                continue;
            }
            let notify = Arc::clone(&notify);
            let dir = dir.clone();
            let ssh = ssh.clone();
            tokio::spawn(subscribe::run(w, ssh, dir, notify));
        }
    });
}

/// Replaces a leftover directory of this pid and creates the new one private.
fn prepare_dir(dir: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::DirBuilderExt;
    match std::fs::remove_dir_all(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    std::fs::DirBuilder::new().mode(0o700).create(dir)
}

/// Removes this process's socket directory at server exit.
pub fn cleanup() {
    let _ = std::fs::remove_dir_all(socket_dir(&std::env::temp_dir()));
}

/// Removes the `yui-herdr-<pid>` directories under `root` whose process is gone.
pub fn sweep_stale(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name
            .to_str()
            .and_then(|n| n.strip_prefix("yui-herdr-"))
            .and_then(|p| p.parse::<libc::pid_t>().ok())
        else {
            continue;
        };
        if pid > 0 && !alive(pid) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Only ESRCH means gone; EPERM is a live process of another user.
fn alive(pid: libc::pid_t) -> bool {
    // SAFETY: signal 0 sends nothing; it only checks that the process exists.
    let sent = unsafe { libc::kill(pid, 0) };
    sent == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

/// One stderr line per event, so an error's newlines never split it.
pub(crate) fn one_line(text: &str) -> String {
    text.replace(['\n', '\r'], " ")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::test_dir::TempDir;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn prepare_dir_replaces_a_leftover_and_is_private() {
        let root = TempDir::new("prep");
        let dir = socket_dir(root.path());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("leftover.sock"), "x").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        prepare_dir(&dir).unwrap();
        assert!(!dir.join("leftover.sock").exists(), "leftover kept");
        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn sweep_removes_only_directories_of_dead_processes() {
        let root = TempDir::new("sweep");
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let dead_pid = child.id();
        child.wait().unwrap();
        let dead = root.path().join(format!("yui-herdr-{dead_pid}"));
        let live = socket_dir(root.path());
        // pid 1 is alive; kill(1, 0) fails with EPERM for a user process.
        let other_user = root.path().join("yui-herdr-1");
        for dir in [&dead, &live, &other_user] {
            std::fs::create_dir_all(dir).unwrap();
        }
        sweep_stale(root.path());
        assert!(!dead.exists(), "dead process directory kept");
        assert!(live.exists(), "live process directory removed");
        assert!(
            other_user.exists(),
            "another user's live process directory removed"
        );
    }
}
