//! The per-server watch state machine: topology, status rebuild, reconcile.

use crate::parse::{self, AgentRow};
use crate::watch::forward::Forward;
use crate::watch::machines::{Endpoint, Watched};
use crate::watch::socket::{self, Conn, SubscribeFail};
use crate::watch::{one_line, signal, Notify};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// What one server's watch carries: its identity, its notifier, and its pane cache.
struct Watch {
    machine: String,
    label: String,
    notify: Notify,
    cache: HashMap<String, AgentRow>,
}

impl Watch {
    fn new(machine: &str, label: &str, notify: &Notify) -> Self {
        Self {
            machine: machine.to_string(),
            label: label.to_string(),
            notify: std::sync::Arc::clone(notify),
            cache: HashMap::new(),
        }
    }

    fn signal(&self, row: &AgentRow, event: &str) {
        (self.notify)(signal::params(
            &self.machine,
            &self.label,
            row,
            event,
            now_ms(),
        ));
    }

    /// A listing inserts only panes missing from the cache, silently; the first listing seeds it.
    fn merge(&mut self, listed: &[AgentRow]) {
        for row in listed {
            self.cache
                .entry(row.id.clone())
                .or_insert_with(|| row.clone());
        }
    }

    /// The listing after subscribing is ground truth: it always overwrites the cache,
    /// and only a cached state that differs notifies (a move into done or blocked).
    fn reconcile(&mut self, listed: &[AgentRow]) {
        for row in listed {
            let changed = self
                .cache
                .get(&row.id)
                .is_some_and(|cached| cached.status != row.status);
            if let Some(event) = changed.then(|| signal::event_type(&row.status)).flatten() {
                self.signal(row, event);
            }
            self.cache.insert(row.id.clone(), row.clone());
        }
        self.cache
            .retain(|id, _| listed.iter().any(|r| &r.id == id));
    }

    fn status_event(&mut self, data: &Value) {
        let Some(pane_id) = data.get("pane_id").and_then(Value::as_str) else {
            return;
        };
        let Some(entry) = self.cache.get_mut(pane_id) else {
            return;
        };
        let Some(status) = data.get("agent_status").and_then(Value::as_str) else {
            return;
        };
        let changed = entry.status != status;
        entry.status = status.to_string();
        if let Some(agent) = data.get("agent").and_then(Value::as_str) {
            entry.agent = agent.to_string();
        }
        if let Some(title) = data.get("title").and_then(Value::as_str) {
            entry.title = title.to_string();
        }
        if changed {
            if let Some(event) = signal::event_type(status) {
                let row = entry.clone();
                self.signal(&row, event);
            }
        }
    }
}

pub async fn run(watched: Watched, ssh: Option<PathBuf>, dir: PathBuf, notify: Notify) {
    // The cache outlives restarts, so a reconnect reports only what changed meanwhile.
    let mut watch = Watch::new(&watched.machine, &watched.label, &notify);
    let mut backoff = Duration::from_secs(5);
    loop {
        if let Err(error) =
            watch_once(&watched, ssh.as_deref(), &dir, &mut watch, &mut backoff).await
        {
            eprintln!(
                "herdr_watch_failed machine={} error={}",
                one_line(&watched.machine),
                one_line(&error)
            );
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(Duration::from_secs(60));
        }
    }
}

/// Steps 1-5 until a failure drops everything for this server.
async fn watch_once(
    watched: &Watched,
    ssh: Option<&Path>,
    dir: &Path,
    watch: &mut Watch,
    backoff: &mut Duration,
) -> Result<(), String> {
    let (sock, _forward) = match &watched.endpoint {
        Endpoint::Local(p) => (p.clone(), None),
        Endpoint::Remote { target, session } => {
            let ssh = ssh.ok_or("ssh not found")?;
            let forward = Forward::open(ssh, target, session, dir).await?;
            (forward.socket().to_path_buf(), Some(forward))
        }
    };
    let mut topology = socket::connect(&sock).await?;
    let subs: Vec<Value> = ["pane.created", "pane.closed", "pane.agent_detected"]
        .into_iter()
        .map(|t| json!({"type": t}))
        .collect();
    socket::subscribe(&mut topology, &subs)
        .await
        .map_err(|e| match e {
            SubscribeFail::Rejected => "topology subscribe rejected".to_string(),
            SubscribeFail::Failed(e) => format!("topology subscribe: {e}"),
        })?;
    let mut health = StatusHealth::default();
    loop {
        let mut status = rebuild(&sock, watch, backoff).await?;
        health.since = status.as_ref().map(|_| tokio::time::Instant::now());
        health.event_seen = false;
        match events(&mut topology, status.as_mut(), watch, &mut health, backoff).await? {
            Flow::Rebuild => continue,
            Flow::StatusFailed(error) => {
                // A status connection that delivered an event or held 60 s earns a fresh backoff.
                if health.event_seen
                    || health
                        .since
                        .is_some_and(|t| t.elapsed() >= Duration::from_secs(60))
                {
                    *backoff = Duration::from_secs(5);
                }
                eprintln!(
                    "herdr_watch_rebuild machine={} error={}",
                    one_line(&watch.machine),
                    one_line(&error)
                );
                tokio::time::sleep(*backoff).await;
                *backoff = (*backoff * 2).min(Duration::from_secs(60));
                continue;
            }
            Flow::TopologyFailed(error) => return Err(error),
        }
    }
}

/// How long the current status connection has held up, and whether it delivered an event.
#[derive(Default)]
struct StatusHealth {
    since: Option<tokio::time::Instant>,
    event_seen: bool,
}

/// Step 3: list, subscribe the listed panes on a fresh connection, list again, reconcile.
async fn rebuild(
    sock: &Path,
    watch: &mut Watch,
    backoff: &mut Duration,
) -> Result<Option<Conn>, String> {
    loop {
        let listed = parse::agent_rows(&socket::agent_list(sock).await?)
            .ok_or_else(|| "agent list missing".to_string())?;
        watch.merge(&listed);
        let mut status = None;
        if !listed.is_empty() {
            let mut conn = socket::connect(sock).await?;
            let subs: Vec<Value> = listed
                .iter()
                .map(|r| json!({"type": "pane.agent_status_changed", "pane_id": r.id}))
                .collect();
            match socket::subscribe(&mut conn, &subs).await {
                Ok(()) => status = Some(conn),
                Err(SubscribeFail::Rejected) => {
                    eprintln!(
                        "herdr_watch_rebuild machine={} error=subscription rejected",
                        one_line(&watch.machine)
                    );
                    tokio::time::sleep(*backoff).await;
                    *backoff = (*backoff * 2).min(Duration::from_secs(60));
                    continue;
                }
                Err(SubscribeFail::Failed(e)) => return Err(e),
            }
        }
        let listed = parse::agent_rows(&socket::agent_list(sock).await?)
            .ok_or_else(|| "agent list missing".to_string())?;
        watch.reconcile(&listed);
        eprintln!(
            "herdr_watch_ready machine={} panes={}",
            one_line(&watch.machine),
            listed.len()
        );
        return Ok(status);
    }
}

enum Flow {
    Rebuild,
    StatusFailed(String),
    TopologyFailed(String),
}

/// Steps 4-5: status events update the cache; topology events rebuild, status loss rebuilds with a backoff.
async fn events(
    topology: &mut Conn,
    mut status: Option<&mut Conn>,
    watch: &mut Watch,
    health: &mut StatusHealth,
    backoff: &mut Duration,
) -> Result<Flow, String> {
    loop {
        tokio::select! {
            line = topology.next_line() => {
                let line = line.map_err(|e| e.to_string())?;
                let Some(line) = line else {
                    return Ok(Flow::TopologyFailed("topology closed".into()));
                };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if value.get("error").is_some() {
                    return Ok(Flow::TopologyFailed(format!("topology error: {line}")));
                }
                return Ok(Flow::Rebuild);
            }
            line = read_status(status.as_deref_mut()) => {
                let line = match line {
                    Err(e) => return Ok(Flow::StatusFailed(e.to_string())),
                    Ok(None) => return Ok(Flow::StatusFailed("status closed".into())),
                    Ok(Some(line)) => line,
                };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if value.get("error").is_some() {
                    return Ok(Flow::StatusFailed(format!("status error: {line}")));
                }
                if value.get("event").and_then(Value::as_str) == Some("pane.agent_status_changed") {
                    health.event_seen = true;
                    *backoff = Duration::from_secs(5);
                    watch.status_event(&value["data"]);
                }
            }
        }
    }
}

async fn read_status(status: Option<&mut Conn>) -> std::io::Result<Option<String>> {
    match status {
        Some(conn) => conn.next_line().await,
        None => std::future::pending().await,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
#[cfg(all(test, unix))]
mod tests {
    use super::run;
    use crate::watch::machines::{Endpoint, Watched};
    use crate::watch::Notify;
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{UnixListener, UnixStream};
    use tokio::sync::{mpsc, Mutex};

    fn pane(id: &str, agent: &str, status: &str, title: &str, cwd: &str) -> Value {
        json!({
            "pane_id": id, "agent": agent, "agent_status": status,
            "workspace_id": "w1", "terminal_title_stripped": title, "cwd": cwd
        })
    }

    struct FakeState {
        panes: Vec<Value>,
        queued: VecDeque<Vec<Value>>,
        reject_next: bool,
        reject_all: bool,
    }

    struct Conn {
        subs: Vec<String>,
        tx: mpsc::Sender<String>,
        close: Arc<tokio::sync::Notify>,
    }

    /// A herdr socket API fake: answers agent.list and events.subscribe, streams the events the test injects.
    struct FakeServer {
        sock: PathBuf,
        dir: PathBuf,
        state: Arc<Mutex<FakeState>>,
        conns: Arc<Mutex<Vec<Conn>>>,
        subscribes: Arc<StdMutex<Vec<Vec<String>>>>,
        attempts: Arc<AtomicUsize>,
        accept: tokio::task::JoinHandle<()>,
    }

    impl FakeServer {
        async fn start() -> FakeServer {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!(
                "yui-herdr-fake-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let sock = dir.join("herdr.sock");
            let listener = UnixListener::bind(&sock).unwrap();
            let state = Arc::new(Mutex::new(FakeState {
                panes: Vec::new(),
                queued: VecDeque::new(),
                reject_next: false,
                reject_all: false,
            }));
            let conns: Arc<Mutex<Vec<Conn>>> = Arc::new(Mutex::new(Vec::new()));
            let subscribes = Arc::new(StdMutex::new(Vec::new()));
            let attempts = Arc::new(AtomicUsize::new(0));
            let (s, c, subs, att) = (
                state.clone(),
                conns.clone(),
                subscribes.clone(),
                attempts.clone(),
            );
            let accept = tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    let (s, c, subs, att) = (s.clone(), c.clone(), subs.clone(), att.clone());
                    tokio::spawn(async move { handle(stream, s, c, subs, att).await });
                }
            });
            FakeServer {
                sock,
                dir,
                state,
                conns,
                subscribes,
                attempts,
                accept,
            }
        }

        async fn emit(&self, kind: &str, data: Value) {
            let line = json!({"event": kind, "data": data}).to_string();
            for conn in self.conns.lock().await.iter() {
                if conn.subs.iter().any(|s| s == kind) {
                    let _ = conn.tx.send(line.clone()).await;
                }
            }
        }

        /// Closes the topology connection, forcing the watcher's step-6 restart.
        async fn drop_topology(&self) {
            for conn in self.conns.lock().await.iter() {
                if conn.subs.iter().any(|s| s == "pane.created") {
                    conn.close.notify_waiters();
                }
            }
        }

        fn status_subscribes(&self) -> usize {
            self.subscribes
                .lock()
                .unwrap()
                .iter()
                .filter(|s| s.iter().any(|t| t == "pane.agent_status_changed"))
                .count()
        }

        fn topology_subscribes(&self) -> usize {
            self.subscribes
                .lock()
                .unwrap()
                .iter()
                .filter(|s| s.iter().any(|t| t == "pane.created"))
                .count()
        }

        fn status_attempts(&self) -> usize {
            self.attempts.load(Ordering::Relaxed)
        }
    }

    impl Drop for FakeServer {
        fn drop(&mut self) {
            self.accept.abort();
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    async fn handle(
        stream: UnixStream,
        state: Arc<Mutex<FakeState>>,
        conns: Arc<Mutex<Vec<Conn>>>,
        subscribes: Arc<StdMutex<Vec<Vec<String>>>>,
        attempts: Arc<AtomicUsize>,
    ) {
        let (rd, mut wr) = stream.into_split();
        let mut lines = BufReader::new(rd).lines();
        let mut rx: Option<mpsc::Receiver<String>> = None;
        let close = Arc::new(tokio::sync::Notify::new());
        loop {
            let line = tokio::select! {
                l = lines.next_line() => match l { Ok(Some(l)) => Some(l), _ => break },
                _ = close.notified() => break,
                msg = async { match &mut rx { Some(r) => r.recv().await, None => std::future::pending().await } } => match msg {
                    Some(msg) => {
                        if wr.write_all(format!("{msg}\n").as_bytes()).await.is_err() { break; }
                        continue;
                    }
                    None => break,
                },
            };
            let Some(line) = line else { break };
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let id = v.get("id").cloned().unwrap_or(json!(1));
            match v.get("method").and_then(Value::as_str) {
                Some("agent.list") => {
                    let panes = {
                        let mut s = state.lock().await;
                        s.queued.pop_front().unwrap_or_else(|| s.panes.clone())
                    };
                    let response = json!({"id": id, "result": {"agents": panes}});
                    if wr
                        .write_all(format!("{response}\n").as_bytes())
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Some("events.subscribe") => {
                    let subs: Vec<String> = v
                        .pointer("/params/subscriptions")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .filter_map(|s| {
                                    s.get("type").and_then(Value::as_str).map(String::from)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let has_pane = v
                        .pointer("/params/subscriptions")
                        .and_then(Value::as_array)
                        .is_some_and(|a| a.iter().any(|s| s.get("pane_id").is_some()));
                    let reject = {
                        let mut s = state.lock().await;
                        if has_pane {
                            attempts.fetch_add(1, Ordering::Relaxed);
                        }
                        if has_pane && s.reject_all {
                            true
                        } else if has_pane && s.reject_next {
                            s.reject_next = false;
                            true
                        } else {
                            false
                        }
                    };
                    if reject {
                        break;
                    }
                    subscribes.lock().unwrap().push(subs.clone());
                    let response = json!({"id": id, "result": {"type": "subscription_started"}});
                    if wr
                        .write_all(format!("{response}\n").as_bytes())
                        .await
                        .is_err()
                    {
                        break;
                    }
                    let (tx, r) = mpsc::channel(64);
                    conns.lock().await.push(Conn {
                        subs,
                        tx,
                        close: close.clone(),
                    });
                    rx = Some(r);
                }
                _ => {}
            }
        }
    }

    fn notifier() -> (Notify, mpsc::UnboundedReceiver<Value>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let notify: Notify = Arc::new(move |v| {
            let _ = tx.send(v);
        });
        (notify, rx)
    }

    fn watch(fake: &FakeServer, notify: Notify) -> tokio::task::JoinHandle<()> {
        let watched = Watched {
            machine: "local".into(),
            label: "local".into(),
            endpoint: Endpoint::Local(fake.sock.clone()),
        };
        tokio::spawn(run(watched, None, fake.dir.clone(), notify))
    }

    /// Polls with a deadline instead of sleeping bare.
    async fn wait_until(within: Duration, mut cond: impl FnMut() -> bool) -> bool {
        let deadline = tokio::time::Instant::now() + within;
        while tokio::time::Instant::now() < deadline {
            if cond() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        cond()
    }

    /// Re-emits until the watcher's cache holds the pane, so the event is not lost to a rebuild in flight.
    async fn emit_until_signal(
        fake: &FakeServer,
        rx: &mut mpsc::UnboundedReceiver<Value>,
        kind: &str,
        data: Value,
    ) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            fake.emit(kind, data.clone()).await;
            if let Ok(Some(v)) = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
                return v;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "no notification arrived"
            );
        }
    }

    /// A bounded wait that proves nothing arrives.
    async fn nothing_arrives(rx: &mut mpsc::UnboundedReceiver<Value>, message: &str) {
        let got = tokio::time::timeout(Duration::from_millis(300), rx.recv()).await;
        assert!(got.is_err(), "{message}");
    }

    #[tokio::test]
    async fn a_rejected_subscription_rebuilds_with_a_backoff() {
        let fake = FakeServer::start().await;
        fake.state.lock().await.panes = vec![pane("p1", "claude", "working", "T1", "/tmp")];
        fake.state.lock().await.reject_all = true;
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        assert!(
            wait_until(Duration::from_secs(5), || fake.status_attempts() >= 1).await,
            "no subscribe attempt"
        );
        // The next attempt waits 5 s, so a 3 s window holds at most 2.
        let start = tokio::time::Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            assert!(
                fake.status_attempts() <= 2,
                "hot loop: {} subscribe attempts in {:?}",
                fake.status_attempts(),
                start.elapsed()
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        nothing_arrives(&mut rx, "a rejected subscription signalled").await;
        task.abort();
    }

    #[tokio::test]
    async fn a_pane_already_done_at_start_sends_nothing() {
        let fake = FakeServer::start().await;
        fake.state.lock().await.panes = vec![pane("p1", "claude", "done", "T1", "/tmp")];
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        assert!(
            wait_until(Duration::from_secs(5), || fake.status_subscribes() >= 1).await,
            "no status subscription"
        );
        nothing_arrives(&mut rx, "a pane already done at start signalled").await;
        task.abort();
    }

    #[tokio::test]
    async fn a_restart_reports_only_the_state_that_changed_during_the_disconnect() {
        let fake = FakeServer::start().await;
        fake.state.lock().await.panes = vec![
            pane("p1", "claude", "done", "T1", "/tmp"),
            pane("p2", "codex", "working", "T2", "/home"),
        ];
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        assert!(
            wait_until(Duration::from_secs(5), || fake.status_subscribes() >= 1).await,
            "no first status subscription"
        );
        nothing_arrives(&mut rx, "startup signalled").await;
        fake.state.lock().await.panes = vec![
            pane("p1", "claude", "done", "T1", "/tmp"),
            pane("p2", "codex", "done", "T2", "/home"),
        ];
        fake.drop_topology().await;
        assert!(
            wait_until(Duration::from_secs(15), || fake.status_subscribes() >= 2).await,
            "no restart after the topology connection closed"
        );
        let got = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await;
        assert!(
            matches!(got, Ok(Some(_))),
            "no notification for the change during the disconnect"
        );
        let params = got.unwrap().unwrap();
        assert_eq!(
            params["signals"],
            json!([{"machine": "local", "machine_label": "local", "pane": "p2", "agent": "codex", "status": "done", "title": "T2", "cwd": "/home"}])
        );
        nothing_arrives(&mut rx, "the pane that stayed done signalled again").await;
        task.abort();
    }

    #[tokio::test]
    async fn a_reconcile_listing_overwrites_the_cache_so_a_later_done_signals() {
        let fake = FakeServer::start().await;
        {
            let mut s = fake.state.lock().await;
            // Each rebuild lists twice: before subscribing and in the reconcile.
            s.queued = VecDeque::from([
                vec![pane("p1", "claude", "done", "T1", "/tmp")],
                vec![pane("p1", "claude", "done", "T1", "/tmp")],
                vec![pane("p1", "claude", "idle", "T1", "/tmp")],
                vec![pane("p1", "claude", "idle", "T1", "/tmp")],
            ]);
            s.panes = vec![pane("p1", "claude", "done", "T1", "/tmp")];
        }
        let queued_left = |n: usize| fake.state.try_lock().is_ok_and(|s| s.queued.len() == n);
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        assert!(
            wait_until(Duration::from_secs(5), || queued_left(2)).await,
            "no first rebuild"
        );
        fake.emit("pane.created", json!({"pane": {"pane_id": "p2"}}))
            .await;
        assert!(
            wait_until(Duration::from_secs(5), || queued_left(0)).await,
            "no rebuild listing idle"
        );
        nothing_arrives(&mut rx, "done to idle signalled").await;
        fake.emit("pane.created", json!({"pane": {"pane_id": "p3"}}))
            .await;
        let got = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await;
        assert!(
            matches!(got, Ok(Some(_))),
            "no notification for idle to done between reconciles"
        );
        let params = got.unwrap().unwrap();
        assert_eq!(params["envelope"]["event_type"], json!("agent_done"));
        assert_eq!(params["signals"][0]["pane"], json!("p1"));
        nothing_arrives(&mut rx, "idle to done signalled twice").await;
        task.abort();
    }

    #[tokio::test]
    async fn status_changes_into_done_and_blocked_signal_once() {
        let fake = FakeServer::start().await;
        fake.state.lock().await.panes = vec![pane("p1", "claude", "working", "T1", "/tmp")];
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        assert!(
            wait_until(Duration::from_secs(5), || fake.status_subscribes() >= 1).await,
            "no status subscription"
        );
        let params = emit_until_signal(
            &fake,
            &mut rx,
            "pane.agent_status_changed",
            json!({"agent": "claude", "agent_status": "done", "pane_id": "p1", "workspace_id": "w1"}),
        )
        .await;
        let occurred = params["envelope"]["occurred_at"].as_u64().unwrap();
        assert!(occurred > 0);
        assert_eq!(
            params["signals"],
            json!([{"machine": "local", "machine_label": "local", "pane": "p1", "agent": "claude", "status": "done", "title": "T1", "cwd": "/tmp"}])
        );
        assert_eq!(params["envelope"]["source"], json!("herdr"));
        assert_eq!(params["envelope"]["event_type"], json!("agent_done"));
        assert_eq!(params["envelope"]["delivery"], json!("urgent"));
        assert_eq!(
            params["envelope"]["event_id"],
            json!(format!("local:p1:{occurred}"))
        );
        assert_eq!(params["envelope"]["label"], json!("local · claude · T1"));
        fake.emit(
            "pane.agent_status_changed",
            json!({"agent": "claude", "agent_status": "done", "pane_id": "p1", "workspace_id": "w1"}),
        )
        .await;
        nothing_arrives(&mut rx, "repeated done signalled").await;
        fake.emit(
            "pane.agent_status_changed",
            json!({"agent": "claude", "agent_status": "working", "pane_id": "p1", "workspace_id": "w1"}),
        )
        .await;
        fake.emit(
            "pane.agent_status_changed",
            json!({"agent": "claude", "agent_status": "idle", "pane_id": "p1", "workspace_id": "w1"}),
        )
        .await;
        nothing_arrives(&mut rx, "working to idle signalled").await;
        fake.emit(
            "pane.agent_status_changed",
            json!({"agent": "claude", "agent_status": "blocked", "pane_id": "p1", "workspace_id": "w1"}),
        )
        .await;
        let got = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await;
        assert!(
            matches!(got, Ok(Some(_))),
            "no blocked notification arrived"
        );
        let params = got.unwrap().unwrap();
        assert_eq!(params["envelope"]["event_type"], json!("agent_blocked"));
        assert_eq!(params["signals"][0]["status"], json!("blocked"));
        task.abort();
    }

    #[tokio::test]
    async fn a_topology_event_rebuilds_the_status_set_on_the_same_topology_connection() {
        let fake = FakeServer::start().await;
        fake.state.lock().await.panes = vec![pane("p1", "claude", "working", "T1", "/tmp")];
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        assert!(
            wait_until(Duration::from_secs(5), || fake.status_subscribes() >= 1).await,
            "no first status subscription"
        );
        fake.state
            .lock()
            .await
            .panes
            .push(pane("p2", "codex", "working", "T2", "/home"));
        fake.emit("pane.created", json!({"pane": {"pane_id": "p2"}}))
            .await;
        assert!(
            wait_until(Duration::from_secs(5), || fake.status_subscribes() >= 2).await,
            "no rebuild after pane.created"
        );
        let params = emit_until_signal(
            &fake,
            &mut rx,
            "pane.agent_status_changed",
            json!({"agent": "codex", "agent_status": "done", "pane_id": "p2", "workspace_id": "w1"}),
        )
        .await;
        assert_eq!(
            params["signals"],
            json!([{"machine": "local", "machine_label": "local", "pane": "p2", "agent": "codex", "status": "done", "title": "T2", "cwd": "/home"}])
        );
        assert_eq!(
            fake.topology_subscribes(),
            1,
            "the topology connection was replaced"
        );
        task.abort();
    }

    #[tokio::test]
    async fn reconcile_reports_a_change_between_listings_and_a_rejected_subscription_rebuilds() {
        let fake = FakeServer::start().await;
        {
            let mut s = fake.state.lock().await;
            s.panes = vec![pane("p1", "claude", "done", "T1", "/tmp")];
            s.queued
                .push_back(vec![pane("p1", "claude", "working", "T1", "/tmp")]);
        }
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        let got = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await;
        assert!(
            matches!(got, Ok(Some(_))),
            "no reconcile notification arrived"
        );
        let params = got.unwrap().unwrap();
        assert_eq!(params["signals"][0]["pane"], json!("p1"));
        assert_eq!(params["envelope"]["event_type"], json!("agent_done"));
        nothing_arrives(&mut rx, "reconcile signalled twice").await;
        fake.state
            .lock()
            .await
            .panes
            .push(pane("p3", "codex", "working", "T3", "/home"));
        fake.state.lock().await.reject_next = true;
        fake.emit("pane.created", json!({"pane": {"pane_id": "p3"}}))
            .await;
        let params = emit_until_signal(
            &fake,
            &mut rx,
            "pane.agent_status_changed",
            json!({"agent": "codex", "agent_status": "done", "pane_id": "p3", "workspace_id": "w1"}),
        )
        .await;
        assert_eq!(params["signals"][0]["pane"], json!("p3"));
        task.abort();
    }
}
