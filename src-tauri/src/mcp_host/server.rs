//! One running MCP server: start under a deadline, its stderr, its exit, and stop.

use super::launch;
use super::manifest::ServerSpec;
use crate::log_rotation::DateRotatingFile;
use rmcp::model::Tool;
use rmcp::service::{Peer, RoleClient, RunningService, ServiceExt};
use serde::Serialize;
use std::collections::VecDeque;
use std::fmt::Display;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use time::UtcOffset;
use tokio::io::AsyncReadExt;
use tokio::process::ChildStderr;

type Client = RunningService<RoleClient, ()>;

const TAIL_LINES: usize = 20;
/// Bytes kept of one stderr line; the rest up to its newline is dropped.
const MAX_LINE: usize = 2000;

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

    /// Appends `[<server>] <text>` to the file and the tail.
    pub fn line(&self, server: &str, text: &str) {
        let line = format!("[{server}] {text}");
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let (file, tail) = &mut *guard;
        if let Err(e) = file.write_all(format!("{line}\n").as_bytes()) {
            log::warn!("mcp_host_log_write_failed error={e}");
        }
        if tail.len() == TAIL_LINES {
            tail.pop_front();
        }
        tail.push_back(line);
    }

    pub fn tail(&self) -> Vec<String> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.1.iter().cloned().collect()
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
    name: String,
    log: Arc<PluginLog>,
    /// The leader's pid, which is the process group id.
    pgid: Option<u32>,
    /// Owns the child and waits for its exit.
    watch: tokio::task::JoinHandle<()>,
    /// Set by stop, so the exit it causes is not reported as `exited`.
    stopping: Arc<AtomicBool>,
}

impl Server {
    pub fn peer(&self) -> &Peer<RoleClient> {
        self.client.peer()
    }

    /// Closes the connection, then kills the whole process tree.
    pub async fn stop(mut self) {
        let exited = self.watch.is_finished();
        self.stopping.store(true, Ordering::SeqCst);
        let _ = self.client.close().await;
        self.watch.abort();
        let _ = (&mut self.watch).await;
        if !exited {
            kill_group(self.pgid);
        }
        self.log.line(&self.name, "stopped");
    }
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
    let name = spec.name.clone();
    let fail = |phase: Phase, reason: String| {
        log.line(&name, &format!("failed ({}): {reason}", phase_name(phase)));
        Failure { phase, reason }
    };
    let until = tokio::time::Instant::now() + deadline;
    let mut child = launch::command(spec, root, data)
        .and_then(|mut command| command.spawn())
        .map_err(|e| fail(Phase::Spawn, e.to_string()))?;
    let pgid = child.id();
    if let Some(stderr) = child.stderr().take() {
        tokio::spawn(read_stderr(stderr, name.clone(), log.clone()));
    }
    let stdout = child.stdout().take().expect("launch pipes stdout");
    let stdin = child.stdin().take().expect("launch pipes stdin");
    let serving = tokio::time::timeout_at(until, ().serve((stdout, stdin))).await;
    let mut client = match within(serving, deadline) {
        Ok(client) => client,
        Err(reason) => {
            kill_group(pgid);
            drop(child);
            return Err(fail(Phase::Initialize, reason));
        }
    };
    let listing = tokio::time::timeout_at(until, client.peer().list_all_tools()).await;
    let tools = match within(listing, deadline) {
        Ok(tools) => tools,
        Err(reason) => {
            let _ = client.close().await;
            kill_group(pgid);
            drop(child);
            return Err(fail(Phase::List, reason));
        }
    };
    log.line(&name, "started");
    let (watch_name, watch_log) = (name.clone(), log.clone());
    let stopping = Arc::new(AtomicBool::new(false));
    let watch_stopping = stopping.clone();
    let watch = tokio::spawn(async move {
        // The leader alone: the wrapper's own wait also waits for every orphan in the group.
        let reason = match child.inner_mut().wait().await {
            Ok(status) => status
                .code()
                .map_or_else(|| status.to_string(), |code| format!("exit code {code}")),
            Err(e) => e.to_string(),
        };
        if watch_stopping.load(Ordering::SeqCst) {
            return;
        }
        kill_group(pgid);
        watch_log.line(&watch_name, &format!("exited: {reason}"));
        on_exit(reason);
    });
    Ok(Server {
        client,
        tools,
        name,
        log,
        pgid,
        watch,
        stopping,
    })
}

fn phase_name(phase: Phase) -> &'static str {
    match phase {
        Phase::Spawn => "spawn",
        Phase::Initialize => "initialize",
        Phase::List => "list",
    }
}

fn within<T, E: Display>(
    outcome: Result<Result<T, E>, tokio::time::error::Elapsed>,
    deadline: Duration,
) -> Result<T, String> {
    match outcome {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(format!("timed out after {} ms", deadline.as_millis())),
    }
}

/// Splits stderr at newlines into the log; a line longer than `MAX_LINE` keeps its start only.
async fn read_stderr(mut stderr: ChildStderr, server: String, log: Arc<PluginLog>) {
    let mut chunk = [0u8; 4096];
    let mut line = Vec::new();
    let mut discarding = false;
    while let Ok(n @ 1..) = stderr.read(&mut chunk).await {
        for &byte in &chunk[..n] {
            if byte == b'\n' {
                if !discarding {
                    log.line(&server, &decode(&line));
                }
                line.clear();
                discarding = false;
            } else if !discarding {
                line.push(byte);
                if line.len() == MAX_LINE {
                    log.line(&server, &decode(&line));
                    line.clear();
                    discarding = true;
                }
            }
        }
    }
    if !line.is_empty() {
        log.line(&server, &decode(&line));
    }
}

/// Lossy UTF-8, cut to at most `MAX_LINE` bytes at a char boundary.
fn decode(bytes: &[u8]) -> String {
    let mut text = String::from_utf8_lossy(bytes).into_owned();
    let mut end = text.len().min(MAX_LINE);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

/// SIGKILL to the group; on Windows the job object ends the tree when the child drops.
#[cfg(unix)]
fn kill_group(pgid: Option<u32>) {
    use nix::sys::signal::{killpg, Signal};
    let Some(pgid) = pgid else {
        return;
    };
    match killpg(nix::unistd::Pid::from_raw(pgid as i32), Signal::SIGKILL) {
        Ok(()) | Err(nix::errno::Errno::ESRCH) => {}
        Err(e) => log::warn!("mcp_host_killpg_failed pgid={pgid} error={e}"),
    }
}

#[cfg(not(unix))]
fn kill_group(_pgid: Option<u32>) {}

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
