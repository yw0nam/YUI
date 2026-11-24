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
                eprintln!("herdr_signal_failed error={e}");
            }
        }
    });
    Arc::new(move |params| {
        let _ = tx.send(params);
    })
}

pub fn socket_dir() -> PathBuf {
    std::env::temp_dir().join(format!("yui-herdr-{}", std::process::id()))
}

/// One watch task per server: local and every enabled saved machine.
pub fn spawn(locate: fn() -> Option<PathBuf>, notify: Notify) {
    tokio::spawn(async move {
        let servers = machines::watched(locate).await;
        let dir = socket_dir();
        let ssh = crate::locate::find_ssh();
        let mut remote_ok = true;
        if servers
            .iter()
            .any(|s| matches!(s.endpoint, machines::Endpoint::Remote { .. }))
        {
            if let Err(e) = prepare_dir(&dir) {
                eprintln!(
                    "herdr_watch_failed machine=local error=socket dir: {}",
                    one_line(&e.to_string())
                );
                remote_ok = false;
            }
        }
        for server in servers {
            if !remote_ok && matches!(server.endpoint, machines::Endpoint::Remote { .. }) {
                continue;
            }
            let notify = Arc::clone(&notify);
            let dir = dir.clone();
            let ssh = ssh.clone();
            tokio::spawn(subscribe::run(server, ssh, dir, notify));
        }
    });
}

fn prepare_dir(dir: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

/// Removes this process's socket directory at server exit.
pub fn cleanup() {
    let _ = std::fs::remove_dir_all(socket_dir());
}

pub fn sweep_stale() {}

/// One stderr line per event, so an error's newlines never split it.
pub(crate) fn one_line(text: &str) -> String {
    text.replace(['\n', '\r'], " ")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn prepare_dir_replaces_a_leftover_and_is_private() {
        let dir = std::env::temp_dir().join(format!("yui-herdr-prepare-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("leftover.sock"), "x").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        prepare_dir(&dir).unwrap();
        assert!(!dir.join("leftover.sock").exists(), "leftover kept");
        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sweep_removes_only_directories_of_dead_processes() {
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let dead_pid = child.id();
        child.wait().unwrap();
        let dead = std::env::temp_dir().join(format!("yui-herdr-{dead_pid}"));
        let live = socket_dir();
        // pid 1 is alive; kill(1, 0) fails with EPERM for a user process.
        let other_user = std::env::temp_dir().join("yui-herdr-1");
        let other_user_existed = other_user.exists();
        for dir in [&dead, &live, &other_user] {
            std::fs::create_dir_all(dir).unwrap();
        }
        sweep_stale();
        assert!(!dead.exists(), "dead process directory kept");
        assert!(live.exists(), "live process directory removed");
        assert!(
            other_user.exists(),
            "another user's live process directory removed"
        );
        let _ = std::fs::remove_dir_all(&dead);
        let _ = std::fs::remove_dir_all(&live);
        if !other_user_existed {
            let _ = std::fs::remove_dir_all(&other_user);
        }
    }
}
