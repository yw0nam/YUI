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
