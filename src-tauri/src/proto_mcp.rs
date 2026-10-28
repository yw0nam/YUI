//! Prototype-only MCP host (issue #1648 spike, never merged): spawns the throwaway test MCP
//! server over stdio with rmcp 3.8 and relays two Tauri commands to it, so a backend can reach
//! an MCP server's tools through the client-tool path on every transport.
//!
//! Every tool call carries `params._meta = {"io.github.yw0nam.yui/preset": <presetId>}` plus
//! whatever rmcp itself attaches; the test server logs the exact object it receives.

use std::collections::HashMap;
use std::sync::Arc;

use process_wrap::tokio::{CommandWrap, ProcessGroup};
use rmcp::model::{
    CallToolRequestParams, CancelledNotification, CancelledNotificationParam, ClientRequest,
    MetaObject, Request, RequestMetaObject, ServerResult,
};
use rmcp::service::{Peer, PeerRequestOptions, RoleClient, RunningService, ServiceExt};
use rmcp::transport::TokioChildProcess;
use serde_json::{json, Value};

/// The preset `_meta` key the host stamps every tools/call with.
const PRESET_META_KEY: &str = "io.github.yw0nam.yui/preset";

type Client = RunningService<RoleClient, ()>;

pub struct ProtoMcpHost {
    /// Owns the serve loop and transport; only shutdown touches it.
    service: tokio::sync::Mutex<Option<Client>>,
    /// Cheap handle clone for calls; valid as long as `service` holds the running service.
    peer: tokio::sync::Mutex<Option<Arc<Peer<RoleClient>>>>,
    /// In-flight calls by the callId the webview chose; a cancel goes through the one-shot.
    pending: std::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>,
}

impl ProtoMcpHost {
    pub fn new() -> Self {
        Self {
            service: tokio::sync::Mutex::new(None),
            peer: tokio::sync::Mutex::new(None),
            pending: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Spawns the test server, initializes, and lists tools once; later calls reuse the peer.
    async fn ensure_peer(&self) -> Result<Arc<Peer<RoleClient>>, String> {
        let mut guard = self.peer.lock().await;
        if let Some(peer) = guard.as_ref() {
            return Ok(peer.clone());
        }
        let dir = std::env::var("YUI_PROTO_MCP_DIR").unwrap_or_else(|_| {
            "/Users/nam-young-woo/Desktop/codes/waifu/2026/YUI-proto-host/prototype/test-server"
                .into()
        });
        // Process-group leader: the kill goes to the whole group (killpg SIGKILL), taking any
        // grandchild the server spawned with it. The findings' process-wrap 10 option.
        let mut command = CommandWrap::with_new("uv", |c| {
            c.args(["run", "--directory", &dir, "server.py"]);
        });
        command.wrap(ProcessGroup::leader());
        // The test server's stderr is the measurement log; the wdio service does not inherit
        // the app's stderr, so capture it to a file directly.
        let stderr = std::fs::File::create("/tmp/proto-mcp/server-stderr.log")
            .map(std::process::Stdio::from)
            .unwrap_or(std::process::Stdio::inherit());
        let transport = TokioChildProcess::builder(command)
            .stderr(stderr)
            .spawn()
            .map_err(|e| format!("proto_mcp spawn failed: {e}"))?
            .0;
        log::info!("proto_mcp spawning test server from {dir}");
        let client: Client = ()
            .serve(transport)
            .await
            .map_err(|e| format!("proto_mcp initialize failed: {e}"))?;
        let tools = client
            .peer()
            .list_tools(None)
            .await
            .map_err(|e| format!("proto_mcp list_tools failed: {e}"))?;
        let names: Vec<&str> = tools.tools.iter().map(|t| t.name.as_ref()).collect();
        log::info!("proto_mcp initialized; tools={names:?}");
        let peer = Arc::new(client.peer().clone());
        *self.service.lock().await = Some(client);
        *guard = Some(peer.clone());
        Ok(peer)
    }
}

impl Default for ProtoMcpHost {
    fn default() -> Self {
        Self::new()
    }
}

/// Calls one tool on the hosted server and answers the CallToolResult as JSON.
#[tauri::command]
pub async fn proto_mcp_call(
    host: tauri::State<'_, ProtoMcpHost>,
    tool: String,
    args: Option<Value>,
    preset_id: String,
    call_id: String,
) -> Result<Value, String> {
    let peer = host.ensure_peer().await?;
    let mut params = CallToolRequestParams::new(tool.clone());
    if let Some(args) = args {
        let object = args.as_object().cloned().unwrap_or_default();
        if !object.is_empty() {
            params.arguments = Some(object);
        }
    }
    let mut meta = RequestMetaObject(MetaObject::new());
    meta.0
        .0
        .insert(PRESET_META_KEY.to_string(), Value::String(preset_id));
    params.meta = Some(meta);
    let request = ClientRequest::CallToolRequest(Request::new(params));
    let started = std::time::Instant::now();
    log::info!("proto_mcp call start tool={tool} call_id={call_id}");
    let handle = peer
        .send_cancellable_request(request, PeerRequestOptions::default())
        .await
        .map_err(|e| format!("proto_mcp send failed: {e}"))?;
    // The handle moves into the await below, so a cancel works from clones taken now.
    let cancel_peer = handle.peer.clone();
    let cancelled_id = handle.id.clone();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<String>();
    host
        .pending
        .lock()
        .unwrap()
        .insert(call_id.clone(), cancel_tx);
    let outcome = tokio::select! {
        response = handle.await_response() => match response {
            Ok(ServerResult::CallToolResult(result)) => Ok(result),
            Ok(other) => Err(format!("proto_mcp unexpected result: {other:?}")),
            Err(e) => Err(format!("proto_mcp call failed after {:?}: {e}", started.elapsed())),
        },
        reason = cancel_rx => match reason {
            // The MCP spec: the client sends notifications/cancelled for the request's id.
            Ok(reason_text) => {
                let notification = CancelledNotification::new(CancelledNotificationParam::new(
                    Some(cancelled_id),
                    Some(reason_text.clone()),
                ));
                if let Err(e) = cancel_peer.send_notification(notification.into()).await {
                    log::warn!("proto_mcp cancel notification failed: {e}");
                }
                Err(format!("proto_mcp call cancelled: {reason_text}"))
            }
            Err(_) => Err("proto_mcp call settled before the cancel landed".into()),
        },
    };
    host.pending.lock().unwrap().remove(&call_id);
    match outcome {
        Ok(result) => {
            log::info!(
                "proto_mcp call done tool={tool} call_id={call_id} in {:?}",
                started.elapsed()
            );
            let value = json!({
                "content": serde_json::to_value(&result.content)
                    .map_err(|e| format!("serialize failed: {e}"))?,
                "isError": result.is_error.unwrap_or(false),
            });
            Ok(value)
        }
        Err(message) => {
            log::info!("proto_mcp call ended tool={tool} call_id={call_id}: {message}");
            Err(message)
        }
    }
}

/// Cancels one in-flight call: the call's worker sends `notifications/cancelled`.
#[tauri::command]
pub async fn proto_mcp_cancel(
    host: tauri::State<'_, ProtoMcpHost>,
    call_id: String,
) -> Result<(), String> {
    let entry = host.pending.lock().unwrap().remove(&call_id);
    match entry {
        Some(call) => {
            log::info!("proto_mcp cancel requested call_id={call_id}");
            call
                .send("stopped by client".into())
                .map_err(|_| "proto_mcp cancel: call already settled".to_string())
        }
        None => Err(format!("proto_mcp cancel: unknown callId {call_id}")),
    }
}

/// Closes the client on app exit: stdin closes, then the child is killed — the whole process
/// group, because of the ProcessGroup wrap. Runs on the async runtime via block_on.
pub async fn shutdown(host: &ProtoMcpHost) {
    *host.peer.lock().await = None;
    let mut guard = host.service.lock().await;
    if let Some(client) = guard.as_mut() {
        log::info!("proto_mcp shutdown: closing client");
        let _ = client.close().await;
        log::info!("proto_mcp shutdown: client closed");
    }
}
