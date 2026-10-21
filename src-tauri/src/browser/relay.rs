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
    async fn run_answers_not_found_for_a_missing_binary() {
        let missing = std::env::temp_dir().join("yui-no-such-dir/ego-browser");
        let err = Relay::new()
            .run(&missing, "yui-a", "", limits())
            .await
            .unwrap_err();
        assert_eq!(err, "ego lite not found: install ego lite and run it once");
    }
}
