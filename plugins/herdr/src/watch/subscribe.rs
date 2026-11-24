//! The per-server event loop: topology and status subscriptions, rebuild, reconcile.

use crate::watch::machines::Watched;
use crate::watch::Notify;
use std::path::PathBuf;

pub async fn run(_server: Watched, _ssh: Option<PathBuf>, _dir: PathBuf, _notify: Notify) {}

#[cfg(all(test, unix))]
mod tests {
    use super::run;
    use crate::watch::machines::{Endpoint, Watched};
    use crate::watch::Notify;
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
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
    }

    struct Conn {
        subs: Vec<String>,
        tx: mpsc::Sender<String>,
    }

    /// A herdr socket API fake: answers agent.list and events.subscribe, streams the events the test injects.
    struct FakeServer {
        sock: PathBuf,
        dir: PathBuf,
        state: Arc<Mutex<FakeState>>,
        conns: Arc<Mutex<Vec<Conn>>>,
        subscribes: Arc<StdMutex<Vec<Vec<String>>>>,
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
            }));
            let conns: Arc<Mutex<Vec<Conn>>> = Arc::new(Mutex::new(Vec::new()));
            let subscribes = Arc::new(StdMutex::new(Vec::new()));
            let (s, c, subs) = (state.clone(), conns.clone(), subscribes.clone());
            let accept = tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    let (s, c, subs) = (s.clone(), c.clone(), subs.clone());
                    tokio::spawn(async move { handle(stream, s, c, subs).await });
                }
            });
            FakeServer { sock, dir, state, conns, subscribes, accept }
        }

        async fn emit(&self, kind: &str, data: Value) {
            let line = json!({"event": kind, "data": data}).to_string();
            for conn in self.conns.lock().await.iter() {
                if conn.subs.iter().any(|s| s == kind) {
                    let _ = conn.tx.send(line.clone()).await;
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
    ) {
        let (rd, mut wr) = stream.into_split();
        let mut lines = BufReader::new(rd).lines();
        let mut rx: Option<mpsc::Receiver<String>> = None;
        loop {
            let line = if let Some(rx) = &mut rx {
                tokio::select! {
                    l = lines.next_line() => match l { Ok(Some(l)) => Some(l), _ => break },
                    msg = rx.recv() => match msg {
                        Some(msg) => {
                            if wr.write_all(format!("{msg}\n").as_bytes()).await.is_err() { break; }
                            continue;
                        }
                        None => break,
                    },
                }
            } else {
                match lines.next_line().await { Ok(Some(l)) => Some(l), _ => break }
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
                    if wr.write_all(format!("{response}\n").as_bytes()).await.is_err() {
                        break;
                    }
                }
                Some("events.subscribe") => {
                    let subs: Vec<String> = v
                        .pointer("/params/subscriptions")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .filter_map(|s| s.get("type").and_then(Value::as_str).map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let has_pane = v
                        .pointer("/params/subscriptions")
                        .and_then(Value::as_array)
                        .is_some_and(|a| a.iter().any(|s| s.get("pane_id").is_some()));
                    let reject = {
                        let mut s = state.lock().await;
                        if has_pane && s.reject_next {
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
                    if wr.write_all(format!("{response}\n").as_bytes()).await.is_err() {
                        break;
                    }
                    let (tx, r) = mpsc::channel(64);
                    conns.lock().await.push(Conn { subs, tx });
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
        let server = Watched {
            machine: "local".into(),
            label: "local".into(),
            endpoint: Endpoint::Local(fake.sock.clone()),
        };
        tokio::spawn(run(server, None, fake.dir.clone(), notify))
    }

    /// Polls with a deadline instead of sleeping bare.
    async fn wait_until(mut cond: impl FnMut() -> bool) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
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
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            fake.emit(kind, data.clone()).await;
            if let Ok(Some(v)) = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
                return v;
            }
            assert!(tokio::time::Instant::now() < deadline, "no notification arrived");
        }
    }

    /// A bounded wait that proves nothing arrives.
    async fn nothing_arrives(rx: &mut mpsc::UnboundedReceiver<Value>, message: &str) {
        let got = tokio::time::timeout(Duration::from_millis(300), rx.recv()).await;
        assert!(got.is_err(), "{message}");
    }

    #[tokio::test]
    async fn status_changes_into_done_and_blocked_signal_once() {
        let fake = FakeServer::start().await;
        fake.state.lock().await.panes = vec![pane("p1", "claude", "working", "T1", "/tmp")];
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        assert!(wait_until(|| fake.status_subscribes() >= 1).await, "no status subscription");
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
        assert_eq!(params["envelope"]["event_id"], json!(format!("local:p1:{occurred}")));
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
        assert!(matches!(got, Ok(Some(_))), "no blocked notification arrived");
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
        assert!(wait_until(|| fake.status_subscribes() >= 1).await, "no first status subscription");
        fake.state.lock().await.panes.push(pane("p2", "codex", "working", "T2", "/home"));
        fake.emit("pane.created", json!({"pane": {"pane_id": "p2"}})).await;
        assert!(wait_until(|| fake.status_subscribes() >= 2).await, "no rebuild after pane.created");
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
        assert_eq!(fake.topology_subscribes(), 1, "the topology connection was replaced");
        task.abort();
    }

    #[tokio::test]
    async fn reconcile_reports_a_change_between_listings_and_a_rejected_subscription_rebuilds() {
        let fake = FakeServer::start().await;
        {
            let mut s = fake.state.lock().await;
            s.panes = vec![pane("p1", "claude", "done", "T1", "/tmp")];
            s.queued.push_back(vec![pane("p1", "claude", "working", "T1", "/tmp")]);
        }
        let (notify, mut rx) = notifier();
        let task = watch(&fake, notify);
        let got = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await;
        assert!(matches!(got, Ok(Some(_))), "no reconcile notification arrived");
        let params = got.unwrap().unwrap();
        assert_eq!(params["signals"][0]["pane"], json!("p1"));
        assert_eq!(params["envelope"]["event_type"], json!("agent_done"));
        nothing_arrives(&mut rx, "reconcile signalled twice").await;
        fake.state.lock().await.panes.push(pane("p3", "codex", "working", "T3", "/home"));
        fake.state.lock().await.reject_next = true;
        fake.emit("pane.created", json!({"pane": {"pane_id": "p3"}})).await;
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