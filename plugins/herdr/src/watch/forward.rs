//! Holds an `ssh -N -L` forward to a remote herdr socket.

use crate::cli;
use crate::watch::machines;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::process::{Child, Command};

static NEXT: AtomicU64 = AtomicU64::new(0);

/// macOS limits a unix socket path to 104 bytes; leave room for the terminator.
const MAX_PATH: usize = 100;

/// `$HOME` expands on the remote side of the ssh command.
pub fn home_args(target: &str) -> Vec<String> {
    ["-o", "BatchMode=yes", target, "printf", "%s", "$HOME"]
        .into_iter()
        .map(String::from)
        .collect()
}

/// Never ClearAllForwardings (it clears the -L) nor ExitOnForwardFailure (a user's RemoteForward kills ssh).
pub fn forward_args(target: &str, local: &Path, remote: &str) -> Vec<String> {
    vec![
        "-N".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-L".into(),
        format!("{}:{remote}", local.display()),
        target.into(),
    ]
}

pub fn check_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().len() > MAX_PATH {
        Err(format!(
            "socket path over {MAX_PATH} bytes: {}",
            path.display()
        ))
    } else {
        Ok(())
    }
}

pub struct Forward {
    local: PathBuf,
    /// kill_on_drop ends ssh when the forward's owner drops.
    _child: Child,
}

impl Forward {
    pub async fn open(
        ssh: &Path,
        target: &str,
        session: &str,
        dir: &Path,
    ) -> Result<Forward, String> {
        let args = home_args(target);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let home = cli::run(ssh, &refs).await?.trim().to_string();
        if home.is_empty() {
            return Err("remote home read returned nothing".into());
        }
        let remote = machines::remote_socket(&home, session);
        let local = dir.join(format!("{}.sock", NEXT.fetch_add(1, Ordering::Relaxed)));
        check_path(&local)?;
        let child = Command::new(ssh)
            .args(forward_args(target, &local, &remote))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("ssh failed to start: {e}"))?;
        Ok(Forward {
            local,
            _child: child,
        })
    }

    pub fn socket(&self) -> &Path {
        &self.local
    }
}

impl Drop for Forward {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.local);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::watch::machines;

    #[test]
    fn ssh_argument_lists_and_the_socket_path_limit() {
        assert_eq!(
            home_args("user@host"),
            ["-o", "BatchMode=yes", "user@host", "printf", "%s", "$HOME"].map(String::from)
        );
        assert_eq!(
            machines::remote_socket("/home/u", "default"),
            "/home/u/.config/herdr/herdr.sock"
        );
        assert_eq!(
            machines::remote_socket("/home/u", "work"),
            "/home/u/.config/herdr/sessions/work/herdr.sock"
        );
        assert_eq!(
            forward_args(
                "user@host",
                Path::new("/tmp/yui-herdr-1/0.sock"),
                "/home/u/.config/herdr/herdr.sock"
            ),
            [
                "-N",
                "-o",
                "BatchMode=yes",
                "-L",
                "/tmp/yui-herdr-1/0.sock:/home/u/.config/herdr/herdr.sock",
                "user@host"
            ]
            .map(String::from)
        );
        assert_eq!(
            forward_args(
                "user@host",
                Path::new("/tmp/yui-herdr-1/1.sock"),
                "/home/u/.config/herdr/sessions/work/herdr.sock"
            ),
            [
                "-N",
                "-o",
                "BatchMode=yes",
                "-L",
                "/tmp/yui-herdr-1/1.sock:/home/u/.config/herdr/sessions/work/herdr.sock",
                "user@host"
            ]
            .map(String::from)
        );
        assert!(check_path(Path::new(&"x".repeat(100))).is_ok());
        assert!(check_path(Path::new(&"x".repeat(101))).is_err());
    }
}
