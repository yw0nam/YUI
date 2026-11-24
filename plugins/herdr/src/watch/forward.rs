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
fn home_args(target: &str) -> Vec<String> {
    ["-o", "BatchMode=yes", target, "printf", "%s", "$HOME"]
        .into_iter()
        .map(String::from)
        .collect()
}

/// Never ClearAllForwardings (it clears the -L) nor ExitOnForwardFailure (a user's RemoteForward kills ssh).
fn forward_args(target: &str, local: &Path, remote: &str) -> Vec<String> {
    vec![
        "-N".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-L".into(),
        format!("{}:{remote}", local.display()),
        target.into(),
    ]
}

fn check_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().len() > MAX_PATH {
        Err(format!(
            "socket path over {MAX_PATH} bytes: {}",
            path.display()
        ))
    } else {
        Ok(())
    }
}

#[derive(Debug)]
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
    use std::sync::atomic::{AtomicU64, Ordering};

    const FAKE_SSH: &str = r#"#!/bin/sh
dir=$(dirname "$0")
sep=$(printf '\037')
line=
for a in "$@"; do line="${line}${a}${sep}"; done
printf '%s\n' "$line" >> "$dir/argv.log"
if [ -f "$dir/fail" ]; then cat "$dir/fail" >&2; exit 1; fi
for a in "$@"; do
  if [ "$a" = "printf" ]; then cat "$dir/home.txt"; exit 0; fi
done
sleep 30
"#;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!(
                "yui-herdr-ssh-{}-{}-{}",
                std::process::id(),
                tag,
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        /// A fake ssh that records its argv, prints the home for the home read, and holds the forward.
        fn fake_ssh(&self) -> PathBuf {
            use std::os::unix::fs::PermissionsExt;
            let bin = self.0.join("ssh");
            std::fs::write(&bin, FAKE_SSH).unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::write(self.0.join("home.txt"), "/home/u").unwrap();
            bin
        }

        fn argv_calls(&self) -> Vec<Vec<String>> {
            let text = std::fs::read_to_string(self.0.join("argv.log")).unwrap_or_default();
            text.lines()
                .map(|l| {
                    l.split('\u{1f}')
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .collect()
                })
                .collect()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Polls with a deadline: the forward's child records its argv after the spawn returns.
    async fn wait_until(mut cond: impl FnMut() -> bool) -> bool {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            if cond() {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        cond()
    }

    #[tokio::test]
    async fn forward_opens_with_the_stated_ssh_arguments() {
        let dir = TempDir::new("args");
        let ssh = dir.fake_ssh();
        let socks = dir.0.join("socks");
        std::fs::create_dir_all(&socks).unwrap();
        let default = Forward::open(&ssh, "user@host", "default", &socks)
            .await
            .unwrap();
        assert!(
            wait_until(|| dir.argv_calls().len() >= 2).await,
            "first forward argv not recorded"
        );
        let named = Forward::open(&ssh, "user@host", "work", &socks)
            .await
            .unwrap();
        assert!(
            wait_until(|| dir.argv_calls().len() >= 4).await,
            "argv not recorded"
        );
        let calls = dir.argv_calls();
        assert_eq!(
            calls[0],
            ["-o", "BatchMode=yes", "user@host", "printf", "%s", "$HOME"].map(String::from)
        );
        assert_eq!(
            calls[1],
            [
                "-N".to_string(),
                "-o".to_string(),
                "BatchMode=yes".to_string(),
                "-L".to_string(),
                format!(
                    "{}:/home/u/.config/herdr/herdr.sock",
                    default.socket().display()
                ),
                "user@host".to_string(),
            ]
        );
        assert_eq!(
            calls[2],
            ["-o", "BatchMode=yes", "user@host", "printf", "%s", "$HOME"].map(String::from)
        );
        assert_eq!(
            calls[3],
            [
                "-N".to_string(),
                "-o".to_string(),
                "BatchMode=yes".to_string(),
                "-L".to_string(),
                format!(
                    "{}:/home/u/.config/herdr/sessions/work/herdr.sock",
                    named.socket().display()
                ),
                "user@host".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn forward_refuses_a_socket_path_over_100_bytes() {
        let dir = TempDir::new(&"x".repeat(80));
        let ssh = dir.fake_ssh();
        let err = Forward::open(&ssh, "user@host", "default", &dir.0)
            .await
            .unwrap_err();
        assert!(
            err.starts_with("socket path over 100 bytes: "),
            "err: {err}"
        );
    }
}
