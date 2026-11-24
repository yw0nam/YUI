//! Runs one herdr CLI call under a 15 s timeout.

use std::path::Path;

pub const NOT_FOUND: &str = "herdr not found: install herdr and start it once";

pub async fn run(_bin: &Path, _args: &[&str]) -> Result<String, String> {
    Ok(String::new())
}

#[cfg(all(test, unix))]
pub(crate) mod tests {
    use std::path::PathBuf;
    use std::sync::OnceLock;

    const FAKE_BIN: &str = r#"#!/bin/sh
dir=$(dirname "$0")
{ printf '%s\037' "$@"; printf '\n'; } >> "$dir/argv.log"
machine=local
if [ "$1" = "--machine" ]; then machine=$2; shift 2; fi
case "$1" in
  machine) cat "$dir/machines.json" ;;
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

    /// One temp folder shared by test runs; config files beside the script steer each call.
    pub(crate) fn fake_dir() -> PathBuf {
        static DIR: OnceLock<PathBuf> = OnceLock::new();
        DIR.get_or_init(|| {
            use std::os::unix::fs::PermissionsExt;
            let dir = std::env::temp_dir().join("yui-fake-herdr");
            std::fs::create_dir_all(&dir).unwrap();
            // Write then rename, so a concurrent test run never executes a half-written file.
            let staged = dir.join(format!("herdr.{}", std::process::id()));
            std::fs::write(&staged, FAKE_BIN).unwrap();
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::rename(&staged, dir.join("herdr")).unwrap();
            dir
        })
        .clone()
    }

    pub(crate) fn fake_herdr() -> PathBuf {
        fake_dir().join("herdr")
    }

    /// The fake CLI's config is shared, so one test steers it at a time.
    pub(crate) async fn fake_lock() -> tokio::sync::MutexGuard<'static, ()> {
        static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        LOCK.lock().await
    }

    /// Drops every config file and the argv log, keeping the script.
    pub(crate) fn reset() {
        for entry in std::fs::read_dir(fake_dir()).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().is_some_and(|n| n != "herdr") {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    pub(crate) fn write_config(name: &str, content: &str) {
        std::fs::write(fake_dir().join(name), content).unwrap();
    }

    /// One argv per recorded call.
    pub(crate) fn argv_calls() -> Vec<Vec<String>> {
        let text = std::fs::read_to_string(fake_dir().join("argv.log")).unwrap_or_default();
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