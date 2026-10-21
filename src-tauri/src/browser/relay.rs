//! Runs a script in an ego lite task space through the installed `ego-browser` CLI.

use super::{script, shots};
use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub const NOT_FOUND: &str = "ego lite not found: install ego lite and run it once";

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// The script stops itself after this long.
    pub deadline_ms: u64,
    /// The CLI is killed after this long when the script did not stop itself.
    pub kill_after: Duration,
    pub image_cap: usize,
    pub long_edge: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    /// The CLI's stderr, where ego prints the script's logs.
    pub output: String,
    pub exit_code: Option<i32>,
    pub killed: bool,
    pub images: Vec<String>,
    pub dropped: u32,
    pub unreadable: Vec<String>,
}

#[derive(Default)]
pub struct Relay {}

impl Relay {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn run(
        &self,
        bin: &Path,
        space: &str,
        code: &str,
        limits: Limits,
    ) -> Result<RunOutcome, String> {
        let dir = shots::create().map_err(|e| format!("screenshot folder failed: {e}"))?;
        let result = spawn_script(bin, space, &dir, code, limits).await;
        shots::remove(&dir);
        let (output, exit_code, killed) = match result? {
            Some(out) => (out.stderr, out.status.code(), false),
            None => (Vec::new(), None, true),
        };
        Ok(RunOutcome {
            output: String::from_utf8_lossy(&output).into_owned(),
            exit_code,
            killed,
            images: Vec::new(),
            dropped: 0,
            unreadable: Vec::new(),
        })
    }
}

/// The CLI's output, or `None` when it was killed at `limits.kill_after`.
async fn spawn_script(
    bin: &Path,
    space: &str,
    dir: &Path,
    code: &str,
    limits: Limits,
) -> Result<Option<std::process::Output>, String> {
    let mut child = Command::new(bin)
        .arg("nodejs")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(spawn_error)?;
    let script = script::build_script(space, dir, code, limits.deadline_ms);
    let finished = async move {
        if let Some(mut stdin) = child.stdin.take() {
            // A CLI that exits before reading stdin still reports through its exit and stderr.
            if let Err(e) = stdin.write_all(script.as_bytes()).await {
                log::warn!("browser_stdin_failed error={e}");
            }
        }
        child.wait_with_output().await
    };
    match tokio::time::timeout(limits.kill_after, finished).await {
        Ok(output) => output.map(Some).map_err(|e| e.to_string()),
        Err(_) => {
            log::warn!("browser_cli_killed space={space}");
            Ok(None)
        }
    }
}

fn spawn_error(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        NOT_FOUND.to_string()
    } else {
        format!("ego-browser failed to start: {e}")
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::OnceLock;
    use std::time::Duration;

    /// Mirrors ego's `nodejs` prelude: logs go to stderr, `taskSpace` pages write a 1×1 PNG.
    const FAKE_PRELUDE: &str = r#"import { writeFileSync, writeSync } from "node:fs";
const __fakeWrite = (prefix, args) => writeSync(2, prefix + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
console.log = (...a) => __fakeWrite("", a);
console.error = (...a) => __fakeWrite("[error] ", a);
const __fakePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
globalThis.taskSpace = async (name) => ({
  name,
  page: () => ({
    screenshot: async ({ path }) => {
      const corrupt = globalThis.corruptNextShot === true;
      globalThis.corruptNextShot = false;
      writeFileSync(path, corrupt ? "not a png" : __fakePng);
    },
  }),
});"#;

    const FAKE_GUIDE: &str = "fake ego-browser guide\nline two\n";

    /// A fake `ego-browser` written once per test process: `skill` prints the guide, `nodejs` execs node.
    fn fake_ego() -> PathBuf {
        static BIN: OnceLock<PathBuf> = OnceLock::new();
        BIN.get_or_init(|| {
            use std::os::unix::fs::PermissionsExt;
            let node = std::process::Command::new("node").arg("--version").output();
            assert!(
                node.is_ok_and(|o| o.status.success()),
                "node is required on PATH for the fake ego-browser tests"
            );
            let dir = std::env::temp_dir().join(format!("yui-fake-ego-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("prelude.mjs"), FAKE_PRELUDE).unwrap();
            std::fs::write(dir.join("guide.txt"), FAKE_GUIDE).unwrap();
            let bin = dir.join("ego-browser");
            std::fs::write(
                &bin,
                r#"#!/bin/sh
dir=$(dirname "$0")
case "$1" in
  skill) cat "$dir/guide.txt" ;;
  nodejs) exec node --input-type=module -e "$(cat "$dir/prelude.mjs")
$(cat)" ;;
  *) exit 2 ;;
esac
"#,
            )
            .unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            bin
        })
        .clone()
    }

    fn limits() -> Limits {
        Limits {
            deadline_ms: 300,
            kill_after: Duration::from_millis(1500),
            image_cap: 4,
            long_edge: 1280,
        }
    }

    #[tokio::test]
    async fn run_returns_the_logged_output_on_success() {
        let out = Relay::new()
            .run(&fake_ego(), "yui-a", r#"console.log("hi");"#, limits())
            .await
            .unwrap();
        assert!(out.output.contains("hi"), "output: {}", out.output);
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.killed);
        assert!(out.images.is_empty());
    }

    #[tokio::test]
    async fn run_returns_earlier_logs_and_the_error_when_the_script_throws() {
        let code = r#"console.log("before"); throw new Error("boom");"#;
        let out = Relay::new()
            .run(&fake_ego(), "yui-a", code, limits())
            .await
            .unwrap();
        assert!(out.output.contains("before"), "output: {}", out.output);
        assert!(out.output.contains("boom"), "output: {}", out.output);
        assert_ne!(out.exit_code, Some(0));
    }

    #[tokio::test]
    async fn run_stops_a_script_awaiting_past_the_deadline() {
        let code = "await new Promise((r) => setTimeout(r, 5000));";
        let out = Relay::new()
            .run(&fake_ego(), "yui-a", code, limits())
            .await
            .unwrap();
        assert!(
            out.output.contains("[error] [yui] deadline"),
            "output: {}",
            out.output
        );
        assert_eq!(out.exit_code, Some(124));
        assert!(!out.killed);
    }

    #[tokio::test]
    async fn run_kills_a_script_that_never_yields_to_its_deadline() {
        let started = std::time::Instant::now();
        let out = tokio::time::timeout(
            limits().kill_after + Duration::from_secs(1),
            Relay::new().run(&fake_ego(), "yui-a", "while (true) {}", limits()),
        )
        .await
        .expect("run returns within kill_after + 1 s")
        .unwrap();
        assert!(out.killed);
        assert!(started.elapsed() < limits().kill_after + Duration::from_secs(1));
    }

    #[tokio::test]
    async fn run_answers_not_found_for_a_missing_binary() {
        let missing = std::env::temp_dir().join("yui-no-such-dir/ego-browser");
        let err = Relay::new()
            .run(&missing, "yui-a", "", limits())
            .await
            .unwrap_err();
        assert_eq!(err, "ego lite not found: install ego lite and run it once");
    }
}
