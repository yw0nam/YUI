//! In-flight tool calls keyed by (window label, call id): preset `_meta`, deadline, cancel, and the
//! cancels that arrived before their call registered.

use super::snapshot::ToolEntry;
use rmcp::model::{
    CallToolRequestParams, CancelledNotification, CancelledNotificationParam, ClientRequest,
    MetaObject, Request, RequestMetaObject, ServerResult,
};
use rmcp::service::{Peer, PeerRequestOptions, RoleClient};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

const PRESET_META_KEY: &str = "io.github.yw0nam.yui/preset";
const WAIT_MS_META_KEY: &str = "io.github.yw0nam.yui/wait_ms";
const DEFAULT_WAIT_MS: u64 = 30_000;
const MAX_WAIT_MS: u64 = 120_000;
const EARLY_CANCEL_CAP: usize = 64;

type Key = (String, String);

#[derive(Default)]
pub struct Calls {
    state: Mutex<State>,
    next_token: AtomicU64,
}

#[derive(Default)]
struct State {
    pending: HashMap<Key, Pending>,
    /// Cancels not yet taken by their call; capped, as a cancel can outlive its call.
    early: Vec<Key>,
}

/// A registered call, ready to send.
pub struct Call {
    key: Key,
    token: u64,
    cancel_rx: oneshot::Receiver<oneshot::Sender<()>>,
}

struct Pending {
    /// Tells a call's own entry from a later one under the same key.
    token: u64,
    /// `<pluginId>/<serverName>` of the server the call went to.
    server: String,
    /// Carries a sender the call answers once its `notifications/cancelled` is sent.
    cancel: oneshot::Sender<oneshot::Sender<()>>,
}

impl Calls {
    /// Reserves `(window, call_id)` for a call to `server`; a key still in flight or cancelled first is refused.
    pub fn register(&self, window: &str, call_id: &str, server: &str) -> Result<Call, String> {
        let key = (window.to_string(), call_id.to_string());
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        let (cancel, cancel_rx) = oneshot::channel();
        let mut state = self.lock();
        if let Some(index) = state.early.iter().position(|k| k == &key) {
            state.early.remove(index);
            return Err("plugin tool cancelled".into());
        }
        if state.pending.contains_key(&key) {
            return Err(format!("duplicate call id: {call_id}"));
        }
        state.pending.insert(
            key.clone(),
            Pending {
                token,
                server: server.to_string(),
                cancel,
            },
        );
        Ok(Call {
            key,
            token,
            cancel_rx,
        })
    }

    /// Sends `tools/call` and waits for the result, the tool's deadline, or a cancel.
    pub async fn call(
        &self,
        call: Call,
        peer: &Peer<RoleClient>,
        tool: &ToolEntry,
        arguments: Value,
        preset_id: &str,
    ) -> Result<Value, String> {
        let Call {
            key,
            token,
            cancel_rx,
        } = call;
        let wait_ms = tool
            .meta
            .as_ref()
            .and_then(|m| m.get(WAIT_MS_META_KEY))
            .and_then(Value::as_u64)
            .filter(|&ms| ms > 0)
            .unwrap_or(DEFAULT_WAIT_MS)
            .min(MAX_WAIT_MS);
        let mut params = CallToolRequestParams::new(tool.name.clone());
        params.arguments = arguments.as_object().filter(|a| !a.is_empty()).cloned();
        let mut meta = MetaObject::new();
        meta.0
            .insert(PRESET_META_KEY.to_string(), Value::String(preset_id.into()));
        let options = PeerRequestOptions::no_options().with_meta(RequestMetaObject(meta));
        let request = ClientRequest::CallToolRequest(Request::new(params));
        let handle = match peer.send_cancellable_request(request, options).await {
            Ok(handle) => handle,
            Err(e) => {
                self.remove(&key, token);
                return Err(e.to_string());
            }
        };
        // `await_response` consumes the handle, so a cancel works from these clones.
        let (cancel_peer, request_id) = (handle.peer.clone(), handle.id.clone());
        let outcome = tokio::select! {
            response = handle.await_response() => Some(response),
            _ = tokio::time::sleep(Duration::from_millis(wait_ms)) => None,
            Ok(sent) = cancel_rx => {
                notify_cancelled(&cancel_peer, request_id, "stopped by client").await;
                let _ = sent.send(());
                return Err("plugin tool cancelled".into());
            }
        };
        self.remove(&key, token);
        match outcome {
            Some(Ok(ServerResult::CallToolResult(result))) => Ok(json!({
                "content": serde_json::to_value(&result.content).map_err(|e| e.to_string())?,
                "isError": result.is_error.unwrap_or(false),
            })),
            Some(Ok(other)) => Err(format!("unexpected tools/call result: {other:?}")),
            Some(Err(e)) => Err(e.to_string()),
            None => {
                notify_cancelled(&cancel_peer, request_id, "timed out").await;
                Err(format!("plugin tool timed out after {wait_ms} ms"))
            }
        }
    }

    /// Stops the call now, or when it registers if the cancel arrives first.
    pub fn cancel(&self, window: &str, call_id: &str) {
        let key = (window.to_string(), call_id.to_string());
        let mut state = self.lock();
        if state.pending.contains_key(&key) {
            let _ = state.take(|k, _| k == &key);
        } else {
            state.record_early(key);
        }
    }

    pub fn cancel_window(&self, window: &str) {
        let _ = self.lock().take(|(w, _), _| w == window);
    }

    /// Cancels every call to the server and waits until each has sent its cancellation.
    pub async fn cancel_server(&self, server_id: &str) {
        let sent = self.lock().take(|_, p| p.server == server_id);
        for sent in sent {
            let _ = sent.await;
        }
    }

    fn remove(&self, key: &Key, token: u64) {
        let mut state = self.lock();
        if state.pending.get(key).is_some_and(|p| p.token == token) {
            state.pending.remove(key);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl State {
    fn take(&mut self, which: impl Fn(&Key, &Pending) -> bool) -> Vec<oneshot::Receiver<()>> {
        let keys: Vec<Key> = self
            .pending
            .iter()
            .filter(|(key, p)| which(key, p))
            .map(|(key, _)| key.clone())
            .collect();
        keys.into_iter()
            .filter_map(|key| self.pending.remove(&key))
            .map(|entry| {
                let (sent, sent_rx) = oneshot::channel();
                let _ = entry.cancel.send(sent);
                sent_rx
            })
            .collect()
    }

    fn record_early(&mut self, key: Key) {
        if self.early.len() == EARLY_CANCEL_CAP {
            self.early.remove(0);
        }
        self.early.push(key);
    }
}

async fn notify_cancelled(
    peer: &Peer<RoleClient>,
    request_id: rmcp::model::RequestId,
    reason: &str,
) {
    let notification = CancelledNotification::new(CancelledNotificationParam::new(
        Some(request_id),
        Some(reason.to_string()),
    ));
    if let Err(e) = peer.send_notification(notification.into()).await {
        log::warn!("mcp_host_cancel_notify_failed error={e}");
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::test_support::{
        eventually, require_python, running, server_logged_a_cancel, slow_call,
    };
    use super::Calls;
    use serde_json::{json, Value};
    use std::time::Duration;

    #[tokio::test]
    async fn a_call_carries_the_preset_in_its_meta() {
        require_python();
        let host = running("yui-test").await;
        let result = host
            .call("pet-a", "c1", "echo_meta", json!({}), "preset-1")
            .await
            .unwrap();
        host.shutdown().await;
        assert_eq!(result["isError"], false);
        let meta: Value =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(meta["io.github.yw0nam.yui/preset"], "preset-1");
    }

    #[tokio::test]
    async fn a_call_times_out_at_the_tools_wait_ms_and_cancels_it() {
        require_python();
        let host = running("yui-test").await;
        let began = std::time::Instant::now();
        let result = host
            .call("pet-a", "c1", "slow", json!({}), "preset-1")
            .await;
        let took = began.elapsed();
        assert_eq!(
            result,
            Err("plugin tool timed out after 1500 ms".to_string())
        );
        assert!(
            took >= Duration::from_millis(1500) && took < Duration::from_secs(5),
            "{took:?}"
        );
        assert!(
            eventually(|| server_logged_a_cancel(&host)).await,
            "{:?}",
            host.log_tail("yui-test")
        );
        host.shutdown().await;
    }

    #[tokio::test]
    async fn a_window_cancels_only_its_own_calls() {
        require_python();
        let host = running("yui-test").await;
        let first = slow_call(&host, "pet-a", "c1");
        tokio::time::sleep(Duration::from_millis(300)).await;
        host.cancel("pet-b", "c1");
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!first.is_finished());
        host.cancel("pet-a", "c1");
        let ended = tokio::time::timeout(Duration::from_secs(1), first).await;
        assert_eq!(
            ended.unwrap().unwrap(),
            Err("plugin tool cancelled".to_string())
        );
        assert!(
            eventually(|| server_logged_a_cancel(&host)).await,
            "{:?}",
            host.log_tail("yui-test")
        );

        let (second, third, other) = (
            slow_call(&host, "pet-a", "c2"),
            slow_call(&host, "pet-a", "c3"),
            slow_call(&host, "pet-b", "c4"),
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        host.cancel_window("pet-a");
        for call in [second, third] {
            let ended = tokio::time::timeout(Duration::from_secs(1), call).await;
            assert_eq!(
                ended.unwrap().unwrap(),
                Err("plugin tool cancelled".to_string())
            );
        }
        assert!(!other.is_finished());
        host.shutdown().await;
    }

    #[tokio::test]
    async fn a_window_cannot_reuse_the_id_of_a_call_still_in_flight() {
        require_python();
        let host = running("yui-test").await;
        let first = slow_call(&host, "pet-a", "c1");
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(
            host.call("pet-a", "c1", "echo_meta", json!({}), "preset-1")
                .await,
            Err("duplicate call id: c1".to_string())
        );
        host.cancel("pet-a", "c1");
        let ended = tokio::time::timeout(Duration::from_secs(1), first).await;
        assert_eq!(
            ended.unwrap().unwrap(),
            Err("plugin tool cancelled".to_string())
        );
        let other_window = host
            .call("pet-b", "c1", "echo_meta", json!({}), "preset-1")
            .await;
        assert_eq!(other_window.unwrap()["isError"], false);
        host.shutdown().await;
    }

    #[test]
    fn a_cancel_before_the_call_registers_stops_it_at_once() {
        let calls = Calls::default();
        calls.cancel("w", "c1");
        assert_eq!(
            calls.register("w", "c1", "s").err(),
            Some("plugin tool cancelled".to_string())
        );
    }

    #[test]
    fn an_early_cancel_is_used_once() {
        let calls = Calls::default();
        calls.cancel("w", "c1");
        assert_eq!(
            calls.register("w", "c1", "s").err(),
            Some("plugin tool cancelled".to_string())
        );
        assert_eq!(calls.register("w", "c1", "s").map(|_| ()), Ok(()));
    }

    #[test]
    fn an_early_cancel_belongs_to_its_window() {
        let calls = Calls::default();
        calls.cancel("w2", "c1");
        assert_eq!(calls.register("w", "c1", "s").map(|_| ()), Ok(()));
    }
}
