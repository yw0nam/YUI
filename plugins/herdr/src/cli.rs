//! Runs one herdr CLI call under a 15 s timeout.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

pub const NOT_FOUND: &str = "herdr not found: install herdr and start it once";
const TIMEOUT: Duration = Duration::from_secs(15);

/// The CLI's stdout on exit 0, else the error message from its stderr.
pub async fn run(bin: &Path, args: &[&str]) -> Result<String, String> {
    let child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(spawn_error)?;
    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "herdr timed out".to_string())?
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if let Some(message) = serde_json::from_str::<serde_json::Value>(&stderr)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .and_then(|m| m.as_str())
                .map(String::from)
        })
    {
        return Err(message);
    }
    let trimmed = stderr.trim();
    if !trimmed.is_empty() {
        return Err(trimmed.to_string());
    }
    Err(format!(
        "exited with code {}",
        output
            .status
            .code()
            .map_or_else(|| "unknown".to_string(), |c| c.to_string())
    ))
}

fn spawn_error(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        NOT_FOUND.to_string()
    } else {
        format!("herdr failed to start: {e}")
    }
}

#[cfg(all(test, unix))]
pub(crate) mod tests {
    use crate::test_dir::TempDir;
    use std::path::PathBuf;
    use std::sync::Mutex;

    const FAKE_BIN: &str = r#"#!/bin/sh
dir=$(dirname "$0")
sep=$(printf '\037')
line=
for a in "$@"; do line="${line}${a}${sep}"; done
printf '%s\n' "$line" >> "$dir/argv.log"
machine=local
if [ "$1" = "--machine" ]; then machine=$2; shift 2; fi
case "$1" in
  machine)
    if [ -f "$dir/machines.err" ]; then cat "$dir/machines.err" >&2; exit 1; fi
    cat "$dir/machines.json" ;;
  agent)
    if [ -f "$dir/$machine.sleep" ]; then sleep "$(cat "$dir/$machine.sleep")"; fi
    if [ -f "$dir/$machine.err" ]; then cat "$dir/$machine.err" >&2; exit 1; fi
    case "$2" in
      list) cat "$dir/agents-$machine.json" ;;
      read) cat "$dir/read.txt" ;;
      *) printf '{"result":{"type":"ok"}}\n' ;;
    esac ;;
  *) exit 2 ;;
esac
"#;

    /// The fake CLI the server's `locate` finds; set while a test holds a `FakeHerdr`.
    static CURRENT: Mutex<Option<PathBuf>> = Mutex::new(None);

    /// One test's fake CLI: its own folder, where config files beside the script steer each call.
    pub(crate) struct FakeHerdr {
        dir: TempDir,
        _lock: tokio::sync::MutexGuard<'static, ()>,
    }

    /// `locate` is a fn pointer, so one test at a time owns the fake.
    pub(crate) async fn fake_herdr() -> FakeHerdr {
        static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        let lock = LOCK.lock().await;
        let dir = TempDir::new("cli");
        *CURRENT.lock().unwrap() = Some(dir.script("herdr", FAKE_BIN));
        FakeHerdr { dir, _lock: lock }
    }

    pub(crate) fn locate_fake() -> Option<PathBuf> {
        CURRENT.lock().unwrap().clone()
    }

    impl FakeHerdr {
        pub(crate) fn write_config(&self, name: &str, content: &str) {
            std::fs::write(self.dir.path().join(name), content).unwrap();
        }

        pub(crate) fn argv_calls(&self) -> Vec<Vec<String>> {
            self.dir.argv_calls()
        }
    }

    impl Drop for FakeHerdr {
        fn drop(&mut self) {
            *CURRENT.lock().unwrap() = None;
        }
    }
}
