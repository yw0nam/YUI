//! In-flight tool calls keyed by (window label, call id): preset `_meta`, deadline, cancel.

use super::snapshot::ToolEntry;
use rmcp::model::{
    CallToolRequestParams, CancelledNotification, CancelledNotificationParam, ClientRequest,
    MetaObject, Request, RequestMetaObject, ServerResult,
};
use rmcp::service::{Peer, PeerRequestOptions, RoleClient};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

const PRESET_META_KEY: &str = "io.github.yw0nam.yui/preset";
const WAIT_MS_META_KEY: &str = "io.github.yw0nam.yui/wait_ms";
const DEFAULT_WAIT_MS: u64 = 30_000;
const MAX_WAIT_MS: u64 = 120_000;

#[derive(Default)]
pub struct Calls {
    pending: Mutex<HashMap<(String, String), oneshot::Sender<()>>>,
}

impl Calls {
    /// Sends `tools/call` and waits for the result, the tool's deadline, or a cancel.
    pub async fn call(
        &self,
        peer: &Peer<RoleClient>,
        window: &str,
        call_id: &str,
        tool: &ToolEntry,
        arguments: Value,
        preset_id: &str,
    ) -> Result<Value, String> {
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
        let handle = peer
            .send_cancellable_request(request, options)
            .await
            .map_err(|e| e.to_string())?;
        // `await_response` consumes the handle, so a cancel works from these clones.
        let (cancel_peer, request_id) = (handle.peer.clone(), handle.id.clone());
        let key = (window.to_string(), call_id.to_string());
        let (cancel_tx, cancel_rx) = oneshot::channel();
        self.lock().insert(key.clone(), cancel_tx);
        let outcome = tokio::select! {
            response = handle.await_response() => Some(response),
            _ = tokio::time::sleep(Duration::from_millis(wait_ms)) => None,
            Ok(()) = cancel_rx => {
                notify_cancelled(&cancel_peer, request_id, "stopped by client").await;
                return Err("plugin tool cancelled".into());
            }
        };
        self.lock().remove(&key);
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

    /// Cancels the call only when `window` started it.
    pub fn cancel(&self, window: &str, call_id: &str) {
        let key = (window.to_string(), call_id.to_string());
        if let Some(cancel) = self.lock().remove(&key) {
            let _ = cancel.send(());
        }
    }

    pub fn cancel_window(&self, window: &str) {
        let mut pending = self.lock();
        let keys: Vec<_> = pending
            .keys()
            .filter(|(w, _)| w == window)
            .cloned()
            .collect();
        for key in keys {
            if let Some(cancel) = pending.remove(&key) {
                let _ = cancel.send(());
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<(String, String), oneshot::Sender<()>>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
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
    use super::super::test_support::{eventually, require_python, running, slow_call};
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
        let cancelled = || {
            host.log_tail("yui-test")
                .unwrap()
                .iter()
                .any(|l| l.starts_with("[main] cancelled id="))
        };
        assert!(
            eventually(cancelled).await,
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
}
