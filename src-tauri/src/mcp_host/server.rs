//! One running MCP server: start under a deadline, its stderr, its exit, and stop.

use super::launch;
use super::manifest::ServerSpec;
use super::tree::Tree;
use crate::log_rotation::DateRotatingFile;
use process_wrap::tokio::ChildWrapper;
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
/// How long a server gets to exit after its stdin closes, so it can act on what it already read.
const EXIT_GRACE: Duration = Duration::from_secs(1);
/// Bytes kept of one stderr line; the rest up to its newline is dropped.
const MAX_LINE: usize = 2000;

/// One plugin's log file and its last 20 lines.
pub struct PluginLog {
    plugin_id: String,
    inner: Mutex<(DateRotatingFile, VecDeque<String>)>,
}

impl PluginLog {
    pub fn new(dir: PathBuf, plugin_id: &str, offset: UtcOffset) -> Self {
        Self {
            plugin_id: plugin_id.to_string(),
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

    /// The stop line in the plugin log and the app log.
    fn stopped(&self, server: &str) {
        self.line(server, "stopped");
        log::info!(
            "mcp_server_stopped plugin={} server={server}",
            self.plugin_id
        );
    }

    pub fn tail(&self) -> Vec<String> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.1.iter().cloned().collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Phase {
    Spawn,
    Initialize,
    List,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Spawn => "spawn",
            Phase::Initialize => "initialize",
            Phase::List => "list",
        }
    }
}

impl Serialize for Phase {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
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
    tree: Tree,
    /// Owns the child and waits for its exit.
    watch: tokio::task::JoinHandle<()>,
    /// Set by stop, so the exit it causes is not reported as `exited`.
    stopping: Arc<AtomicBool>,
}

impl Server {
    pub fn peer(&self) -> &Peer<RoleClient> {
        self.client.peer()
    }

    /// Closes the connection, waits up to `EXIT_GRACE` for an exit, then kills the tree.
    pub async fn stop(mut self) {
        let exited = self.watch.is_finished();
        self.stopping.store(true, Ordering::SeqCst);
        let _ = self.client.close().await;
        if tokio::time::timeout(EXIT_GRACE, &mut self.watch)
            .await
            .is_err()
        {
            self.tree.kill();
            if tokio::time::timeout(EXIT_GRACE, &mut self.watch)
                .await
                .is_err()
            {
                self.watch.abort();
                let _ = (&mut self.watch).await;
            }
        }
        if !exited {
            self.tree.kill();
        }
        self.log.stopped(&self.name);
    }
}

/// A server process whose connection is not initialized yet.
pub struct Spawned {
    child: Box<dyn ChildWrapper>,
    tree: Tree,
    name: String,
    log: Arc<PluginLog>,
    stopped: Arc<AtomicBool>,
}

impl Spawned {
    pub fn stopper(&self) -> Stopper {
        Stopper {
            tree: self.tree.clone(),
            stopped: self.stopped.clone(),
        }
    }

    pub fn stop(self) {
        kill_tree(&self.tree, self.child);
        self.log.stopped(&self.name);
    }
}

/// Stops a server that is still starting, so its start ends as a stop and not a failure.
pub struct Stopper {
    tree: Tree,
    stopped: Arc<AtomicBool>,
}

impl Stopper {
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.tree.kill();
    }
}

/// Spawns the server and starts copying its stderr into the log.
pub fn spawn(
    spec: &ServerSpec,
    root: &Path,
    data: &Path,
    log: Arc<PluginLog>,
) -> Result<Spawned, Failure> {
    let (mut child, tree) = launch::command(spec, root, data)
        .and_then(Tree::start)
        .map_err(|e| failed(&log, &spec.name, Phase::Spawn, e.to_string()))?;
    if let Some(stderr) = child.stderr().take() {
        tokio::spawn(read_stderr(stderr, spec.name.clone(), log.clone()));
    }
    Ok(Spawned {
        tree,
        child,
        name: spec.name.clone(),
        log,
        stopped: Arc::default(),
    })
}

/// Initializes and lists tools under `deadline`; `on_exit` gets the reason of a later exit.
pub async fn connect(
    spawned: Spawned,
    deadline: Duration,
    on_exit: impl FnOnce(String) + Send + 'static,
) -> Result<Server, Failure> {
    let Spawned {
        mut child,
        tree,
        name,
        log,
        stopped,
    } = spawned;
    let end = |phase: Phase, reason: String| {
        if stopped.load(Ordering::SeqCst) {
            log.stopped(&name);
            Failure { phase, reason }
        } else {
            failed(&log, &name, phase, reason)
        }
    };
    let until = tokio::time::Instant::now() + deadline;
    let stdout = child.stdout().take().expect("launch pipes stdout");
    let stdin = child.stdin().take().expect("launch pipes stdin");
    let serving = tokio::time::timeout_at(until, ().serve((stdout, stdin))).await;
    let mut client = match within(serving, deadline) {
        Ok(client) => client,
        Err(reason) => {
            kill_tree(&tree, child);
            return Err(end(Phase::Initialize, reason));
        }
    };
    let listing = tokio::time::timeout_at(until, client.peer().list_all_tools()).await;
    let tools = match within(listing, deadline) {
        Ok(tools) => tools,
        Err(reason) => {
            let _ = client.close().await;
            kill_tree(&tree, child);
            return Err(end(Phase::List, reason));
        }
    };
    log.line(&name, "started");
    log::info!("mcp_server_started plugin={} server={name}", log.plugin_id);
    let (watch_name, watch_log) = (name.clone(), log.clone());
    let stopping = Arc::new(AtomicBool::new(false));
    let watch_stopping = stopping.clone();
    let watch_tree = tree.clone();
    let watch = tokio::spawn(async move {
        // The leader alone: a process group wrapper's own wait also waits for every orphan.
        let reason = match child.inner_mut().wait().await {
            Ok(status) => status
                .code()
                .map_or_else(|| status.to_string(), |code| format!("exit code {code}")),
            Err(e) => e.to_string(),
        };
        if watch_stopping.load(Ordering::SeqCst) {
            return;
        }
        watch_tree.kill();
        watch_log.line(&watch_name, &format!("exited: {reason}"));
        log::info!(
            "mcp_server_exited plugin={} server={watch_name} reason={reason}",
            watch_log.plugin_id
        );
        on_exit(reason);
    });
    Ok(Server {
        client,
        tools,
        name,
        log,
        tree,
        watch,
        stopping,
    })
}

fn failed(log: &PluginLog, server: &str, phase: Phase, reason: String) -> Failure {
    log.line(server, &format!("failed ({}): {reason}", phase.as_str()));
    log::error!(
        "mcp_server_start.failed plugin={} server={server} phase={} reason={reason}",
        log.plugin_id,
        phase.as_str()
    );
    Failure { phase, reason }
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

fn kill_tree(tree: &Tree, child: Box<dyn ChildWrapper>) {
    tree.kill();
    drop(child);
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::manifest;
    use super::super::test_support::{eventually, fixture, gone, require_python, temp_dir};
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
        let on_exit = move |reason| {
            let _ = tx.send(reason);
        };
        let result = match spawn(&spec, &fixture(), &data, log.clone()) {
            Ok(spawned) => connect(spawned, deadline, on_exit).await,
            Err(failure) => Err(failure),
        };
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
        require_python();
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
        require_python();
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
        require_python();
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
        require_python();
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
        require_python();
        let started = start_fixture(None, None, Duration::from_secs(30)).await;
        let server = started.result.expect("start failed");
        let pid = call_json(&server, "spawn_child").await.as_i64().unwrap() as i32;
        assert!(!gone(pid));
        server.stop().await;
        assert!(eventually(|| gone(pid)).await, "sleep {pid} still runs");
    }
}
