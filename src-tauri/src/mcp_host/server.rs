//! One running MCP server: start under a deadline, its stderr, its exit, and stop.

use super::manifest::ServerSpec;
use crate::log_rotation::DateRotatingFile;
use rmcp::model::Tool;
use rmcp::service::{Peer, RoleClient, RunningService};
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use time::UtcOffset;

type Client = RunningService<RoleClient, ()>;

/// One plugin's log file and its last 20 lines.
pub struct PluginLog {
    inner: Mutex<(DateRotatingFile, VecDeque<String>)>,
}

impl PluginLog {
    pub fn new(dir: PathBuf, plugin_id: &str, offset: UtcOffset) -> Self {
        Self {
            inner: Mutex::new((
                DateRotatingFile::new(dir, plugin_id.to_string(), "log", offset),
                VecDeque::new(),
            )),
        }
    }

    pub fn tail(&self) -> Vec<String> {
        Vec::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Spawn,
    Initialize,
    List,
}

#[derive(Debug, PartialEq)]
pub struct Failure {
    pub phase: Phase,
    pub reason: String,
}

pub struct Server {
    client: Client,
    pub tools: Vec<Tool>,
}

impl Server {
    pub fn peer(&self) -> &Peer<RoleClient> {
        self.client.peer()
    }

    pub async fn stop(self) {}
}

/// Spawns, initializes and lists tools under `deadline`; `on_exit` gets the reason when the
/// server ends by itself after that.
pub async fn start(
    spec: &ServerSpec,
    root: &Path,
    data: &Path,
    log: Arc<PluginLog>,
    deadline: Duration,
    on_exit: impl FnOnce(String) + Send + 'static,
) -> Result<Server, Failure> {
    let _ = (spec, root, data, log, deadline, on_exit);
    Err(Failure {
        phase: Phase::List,
        reason: "unimplemented".into(),
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::manifest;
    use super::super::test_support::{eventually, fixture, gone, has_python, temp_dir};
    use super::*;
    use rmcp::model::CallToolRequestParams;
    use serde_json::{json, Value};

    struct Started {
        result: Result<Server, Failure>,
        log: Arc<PluginLog>,
        log_dir: PathBuf,
        data: PathBuf,
        exit: tokio::sync::oneshot::Receiver<String>,
    }

    async fn start_fixture(
        mode: Option<&str>,
        command: Option<&str>,
        deadline: Duration,
    ) -> Started {
        let mut spec = manifest::read(&fixture()).unwrap().servers.remove(0);
        if let Some(mode) = mode {
            spec.env.insert("FIXTURE_MODE".into(), mode.into());
        }
        if let Some(command) = command {
            spec.command = command.into();
        }
        let base = temp_dir();
        let (log_dir, data) = (base.join("logs"), base.join("data/yui-test"));
        let log = Arc::new(PluginLog::new(log_dir.clone(), "yui-test", UtcOffset::UTC));
        let (tx, exit) = tokio::sync::oneshot::channel();
        let result = start(
            &spec,
            &fixture(),
            &data,
            log.clone(),
            deadline,
            move |reason| {
                let _ = tx.send(reason);
            },
        )
        .await;
        Started {
            result,
            log,
            log_dir,
            data,
            exit,
        }
    }

    async fn call_json(server: &Server, name: &str) -> Value {
        let result = server
            .peer()
            .call_tool(CallToolRequestParams::new(name.to_string()))
            .await
            .unwrap();
        let text = result.content[0].as_text().unwrap().text.clone();
        serde_json::from_str(&text).unwrap()
    }

    #[tokio::test]
    async fn start_lists_tools_and_passes_argv_without_a_shell() {
        if !has_python() {
            return;
        }
        let started = start_fixture(None, None, Duration::from_secs(30)).await;
        let server = started.result.expect("start failed");
        let names: Vec<&str> = server.tools.iter().map(|t| t.name.as_ref()).collect();
        assert_eq!(
            names,
            ["echo_args", "echo_meta", "slow", "spawn_child", "look"]
        );
        assert_eq!(
            serde_json::to_value(&server.tools[2].meta).unwrap(),
            json!({"io.github.yw0nam.yui/wait_ms": 1500})
        );
        let echoed = call_json(&server, "echo_args").await;
        assert_eq!(
            echoed["argv"].as_array().unwrap().last().unwrap(),
            "literal;$(not-run)"
        );
        assert_eq!(echoed["data"], started.data.to_string_lossy().as_ref());
        server.stop().await;
    }

    #[tokio::test]
    async fn start_fails_at_spawn_when_the_command_is_missing() {
        let started =
            start_fixture(None, Some("yui-no-such-command"), Duration::from_secs(30)).await;
        assert_eq!(started.result.err().map(|f| f.phase), Some(Phase::Spawn));
    }

    #[tokio::test]
    async fn start_fails_at_initialize_on_the_deadline_and_kills_the_tree() {
        if !has_python() {
            return;
        }
        let started = start_fixture(Some("hang"), None, Duration::from_millis(300)).await;
        assert_eq!(
            started.result.err().map(|f| f.phase),
            Some(Phase::Initialize)
        );
        let pid_line = |log: &PluginLog| {
            log.tail().iter().find_map(|l| {
                l.strip_prefix("[main] child pid=")
                    .map(|p| p.parse::<i32>().unwrap())
            })
        };
        assert!(
            eventually(|| pid_line(&started.log).is_some()).await,
            "tail: {:?}",
            started.log.tail()
        );
        let pid = pid_line(&started.log).unwrap();
        assert!(eventually(|| gone(pid)).await, "sleep {pid} still runs");
    }

    #[tokio::test]
    async fn a_server_that_ends_after_running_reports_its_exit_code() {
        if !has_python() {
            return;
        }
        let started = start_fixture(Some("exit"), None, Duration::from_secs(30)).await;
        let _server = started.result.expect("start failed");
        let reason = tokio::time::timeout(Duration::from_secs(5), started.exit).await;
        assert_eq!(
            reason.ok().and_then(Result::ok).as_deref(),
            Some("exit code 3")
        );
        let log = started.log;
        assert!(
            eventually(|| {
                let tail = log.tail();
                [
                    "[main] exiting 0",
                    "[main] exiting 1",
                    "[main] exiting 2",
                    "[main] exited: exit code 3",
                ]
                .iter()
                .all(|line| tail.iter().any(|l| l == line))
            })
            .await,
            "tail: {:?}",
            log.tail()
        );
    }

    #[tokio::test]
    async fn stderr_goes_to_the_log_file_and_a_bounded_tail() {
        if !has_python() {
            return;
        }
        let started = start_fixture(Some("noisy"), None, Duration::from_secs(30)).await;
        let server = started.result.expect("start failed");
        let long = format!("[main] {}", "x".repeat(2000));
        let log = started.log.clone();
        assert!(
            eventually(|| log.tail().contains(&long)).await,
            "tail: {:?}",
            log.tail()
        );
        assert_eq!(log.tail().len(), 20);
        let file = std::fs::read_dir(&started.log_dir)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let text = std::fs::read_to_string(file).unwrap();
        for n in 0..50 {
            assert!(
                text.contains(&format!("[main] noise {n}\n")),
                "line {n} missing"
            );
        }
        server.stop().await;
    }

    #[tokio::test]
    async fn stop_kills_the_servers_children() {
        if !has_python() {
            return;
        }
        let started = start_fixture(None, None, Duration::from_secs(30)).await;
        let server = started.result.expect("start failed");
        let pid = call_json(&server, "spawn_child").await.as_i64().unwrap() as i32;
        assert!(!gone(pid));
        server.stop().await;
        assert!(eventually(|| gone(pid)).await, "sleep {pid} still runs");
    }
}
