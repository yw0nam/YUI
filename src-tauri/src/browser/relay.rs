//! Runs a script in an ego lite task space through the installed `ego-browser` CLI.

use super::{script, shots};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
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

pub const LIMITS: Limits = Limits {
    deadline_ms: 25_000,
    kill_after: Duration::from_secs(28),
    image_cap: 4,
    long_edge: 1280,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    /// The CLI's stderr, where ego prints the script's logs.
    pub output: String,
    pub exit_code: Option<i32>,
    /// The prelude's deadline stopped the script.
    pub deadline: bool,
    pub killed: bool,
    pub images: Vec<String>,
    pub dropped: u32,
    pub unreadable: Vec<String>,
}

#[derive(Default)]
pub struct Relay {
    /// One lock per task-space name, held until that space's CLI exits and its screenshots are collected.
    spaces: std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

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
        let lock = Arc::clone(
            self.spaces
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(space.to_string())
                .or_default(),
        );
        let _held = lock.lock().await;
        let dir = shots::create().map_err(|e| format!("screenshot folder failed: {e}"))?;
        let result = spawn_script(bin, space, &dir, code, limits).await;
        let shots = match result {
            Ok(_) => shots::collect(dir.clone(), limits.image_cap, limits.long_edge).await,
            Err(_) => shots::Collected::default(),
        };
        shots::remove(&dir);
        let (output, exit_code, killed) = match result? {
            Some(out) => (out.stderr, out.status.code(), false),
            None => (Vec::new(), None, true),
        };
        let output = String::from_utf8_lossy(&output).into_owned();
        Ok(RunOutcome {
            deadline: exit_code != Some(0) && script::names_deadline(&output),
            output,
            exit_code,
            killed,
            images: shots.images,
            dropped: shots.dropped,
            unreadable: shots.unreadable,
        })
    }

    /// The installed CLI's guide (`ego-browser skill` stdout).
    pub async fn guide(&self, bin: &Path, kill_after: Duration) -> Result<String, String> {
        let child = Command::new(bin)
            .arg("skill")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(spawn_error)?;
        let output = tokio::time::timeout(kill_after, child.wait_with_output())
            .await
            .map_err(|_| "ego-browser skill timed out".to_string())?
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "ego-browser skill failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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

    const FAKE_BIN: &str = r#"#!/bin/sh
dir=$(dirname "$0")
case "$1" in
  skill) cat "$dir/guide.txt" ;;
  nodejs) exec node --input-type=module -e "$(cat "$dir/prelude.mjs")
$(cat)" ;;
  *) exit 2 ;;
esac
"#;

    /// A fake `ego-browser` in one temp folder shared by test runs: `skill` prints the guide, `nodejs` execs node.
    fn fake_ego() -> PathBuf {
        static BIN: OnceLock<PathBuf> = OnceLock::new();
        BIN.get_or_init(|| {
            use std::os::unix::fs::PermissionsExt;
            let node = std::process::Command::new("node").arg("--version").output();
            assert!(
                node.is_ok_and(|o| o.status.success()),
                "node is required on PATH for the fake ego-browser tests"
            );
            let dir = std::env::temp_dir().join("yui-fake-ego");
            std::fs::create_dir_all(&dir).unwrap();
            // Write then rename, so a concurrent test run never executes a half-written file.
            for (name, content, mode) in [
                ("prelude.mjs", FAKE_PRELUDE, 0o644),
                ("guide.txt", FAKE_GUIDE, 0o644),
                ("ego-browser", FAKE_BIN, 0o755),
            ] {
                let staged = dir.join(format!("{name}.{}", std::process::id()));
                std::fs::write(&staged, content).unwrap();
                std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(mode)).unwrap();
                std::fs::rename(&staged, dir.join(name)).unwrap();
            }
            dir.join("ego-browser")
        })
        .clone()
    }

    /// Short deadline; a backstop that only the backstop test reaches, even on a loaded machine.
    fn limits() -> Limits {
        Limits {
            deadline_ms: 300,
            kill_after: Duration::from_secs(20),
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
        assert_eq!(out.exit_code, Some(1));
        assert!(!out.deadline);
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
        assert!(out.deadline);
        assert!(!out.killed);
    }

    #[tokio::test]
    async fn run_kills_a_script_that_never_yields_to_its_deadline() {
        let limits = Limits {
            kill_after: Duration::from_millis(1500),
            ..limits()
        };
        let started = std::time::Instant::now();
        let out = tokio::time::timeout(
            limits.kill_after + Duration::from_secs(1),
            Relay::new().run(&fake_ego(), "yui-a", "while (true) {}", limits),
        )
        .await
        .expect("run returns within kill_after + 1 s")
        .unwrap();
        assert!(out.killed);
        assert!(started.elapsed() < limits.kill_after + Duration::from_secs(1));
    }

    /// The shot folder a run logged as `shot <path>`.
    fn logged_shot_dir(output: &str) -> PathBuf {
        let line = output
            .lines()
            .find_map(|l| l.strip_prefix("shot "))
            .unwrap();
        PathBuf::from(line).parent().unwrap().to_path_buf()
    }

    #[tokio::test]
    async fn run_returns_the_last_screenshots_and_removes_their_folder() {
        let code = r#"const p = task.page("p1");
const shoot = p.screenshot;
p.screenshot = (o) => { console.log("shot " + o.path); return shoot(o); };
for (let i = 0; i < 6; i++) await screenshot(p);"#;
        let out = Relay::new()
            .run(&fake_ego(), "yui-a", code, limits())
            .await
            .unwrap();
        assert_eq!(out.images.len(), 4, "output: {}", out.output);
        assert!(out.images[0].starts_with("data:image/jpeg;base64,"));
        assert_eq!(out.dropped, 2);
        assert!(!logged_shot_dir(&out.output).exists());
    }

    #[tokio::test]
    async fn run_names_a_screenshot_that_does_not_decode() {
        let code = r#"await screenshot(task.page("p1"));
globalThis.corruptNextShot = true;
await screenshot(task.page("p1"));"#;
        let out = Relay::new()
            .run(&fake_ego(), "yui-a", code, limits())
            .await
            .unwrap();
        assert_eq!(out.unreadable, vec!["002.png".to_string()]);
        assert_eq!(out.images.len(), 1);
        assert_eq!(out.dropped, 0);
    }

    const TIMED: &str = r#"console.log("start " + Date.now());
await new Promise((r) => setTimeout(r, 500));
console.log("end " + Date.now());"#;

    /// The `start` and `end` timestamps a `TIMED` run logged.
    fn span(out: &RunOutcome) -> (u64, u64) {
        let at = |key: &str| -> u64 {
            let line = out.output.lines().find_map(|l| l.strip_prefix(key));
            line.unwrap_or_else(|| panic!("no {key} in output: {}", out.output))
                .parse()
                .unwrap()
        };
        (at("start "), at("end "))
    }

    async fn timed_pair(space_a: &str, space_b: &str) -> ((u64, u64), (u64, u64)) {
        let relay = Relay::new();
        let bin = fake_ego();
        let limits = Limits {
            deadline_ms: 5000,
            ..limits()
        };
        let (a, b) = tokio::join!(
            relay.run(&bin, space_a, TIMED, limits),
            relay.run(&bin, space_b, TIMED, limits),
        );
        (span(&a.unwrap()), span(&b.unwrap()))
    }

    #[tokio::test]
    async fn runs_in_one_space_go_one_at_a_time() {
        let (a, b) = timed_pair("yui-a", "yui-a").await;
        assert!(a.1 <= b.0 || b.1 <= a.0, "a: {a:?}, b: {b:?}");
    }

    #[tokio::test]
    async fn runs_in_different_spaces_overlap() {
        let (a, b) = timed_pair("yui-a", "yui-b").await;
        assert!(a.0 < b.1 && b.0 < a.1, "a: {a:?}, b: {b:?}");
    }

    #[tokio::test]
    async fn guide_returns_the_cli_skill_text() {
        let guide = Relay::new()
            .guide(&fake_ego(), limits().kill_after)
            .await
            .unwrap();
        assert_eq!(guide, "fake ego-browser guide\nline two\n");
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
