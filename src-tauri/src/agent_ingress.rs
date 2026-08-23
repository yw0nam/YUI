//! Loopback HTTP ingress — receives lifecycle signals from external coding-agent
//! hooks (task done, or the agent needs the user's input) and opaque `signals`
//! batches from the remote n8n workflow, then re-emits both as Tauri events into
//! the frontend dispatcher.
//!
//! Also serves the avatar RPC surface (`/avatar/*`): body state, perch targets, and
//! semantic movement commands. Those live in the webview, so each request is bridged
//! as an `avatar-rpc` event and answered by the `avatar_rpc_response` command.
//!
//! Binds loopback only; no auth (single-user desktop).

use crate::os_event_watcher::epoch_ms;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const AGENT_INBOX_CHANNEL: &str = "agent-inbox";
pub const SIGNALS_INBOX_CHANNEL: &str = "signals-inbox";
pub const AVATAR_RPC_CHANNEL: &str = "avatar-rpc";
pub const INGRESS_DEAD_CHANNEL: &str = "ingress-dead";

/// Deadline for a webview answer to a read-only avatar query.
const AVATAR_QUERY_TIMEOUT: Duration = Duration::from_secs(2);
/// Deadline for a webview answer to an avatar command — a gesture takes real time.
const AVATAR_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);

const SUMMARY_MAX_BYTES: usize = 8192;
const DETAIL_MAX_BYTES: usize = 16384;
/// Hard body read ceiling; prevents OOM on oversized payloads.
const BODY_CEILING_BYTES: usize = 65536;

/// Lifecycle phase of an external coding-agent session.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentPhase {
    Done,
    NeedsInput,
}

/// `agent-inbox` event payload — fired when an external agent posts to /agent-event.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct AgentEventPayload {
    pub tool: String,
    pub project: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>, // "success" | "error" | absent — meaningful for phase:"done" only
    pub phase: AgentPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>, // opaque pass-through, no client interpretation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>, // judgment material for the backend
    pub summary: String,
    pub ts: i64, // client epoch ms
}

/// `signals-inbox` event payload — fired when the remote n8n workflow posts to
/// `/signals`. `signals` is treated as opaque JSON; the client does not
/// interpret its contents.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct SignalsPayload {
    pub signals: Vec<serde_json::Value>,
    pub ts: i64, // server epoch ms — n8n does not send a timestamp
}

/// Wire shape of a `/signals` POST body, before the server stamps `ts`.
#[derive(Deserialize)]
struct SignalsRequest {
    signals: Vec<serde_json::Value>,
}

/// Side of a window the avatar peeks from.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PeekSide {
    Left,
    Right,
}

/// Named screen spot `move_to` targets.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MoveSpot {
    Center,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Body of a `/avatar/command` POST. The verb set is closed: anything else is a 400.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AvatarCommand {
    SitOnWindow {
        app: String,
    },
    Peek {
        side: PeekSide,
    },
    MoveTo {
        spot: MoveSpot,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        monitor: Option<u32>,
    },
    StandDown,
}

/// A parsed `/avatar/*` request, ready to bridge into the webview.
#[derive(Clone, Debug, PartialEq, Eq)]
enum AvatarRoute {
    State,
    PerchTargets,
    Command(AvatarCommand),
}

impl AvatarRoute {
    /// RPC method name + params carried by the `avatar-rpc` event.
    fn into_rpc(self) -> (&'static str, Option<serde_json::Value>) {
        match self {
            AvatarRoute::State => ("state", None),
            AvatarRoute::PerchTargets => ("perch_targets", None),
            AvatarRoute::Command(cmd) => ("command", serde_json::to_value(cmd).ok()),
        }
    }

    fn timeout(&self) -> Duration {
        match self {
            AvatarRoute::Command(_) => AVATAR_COMMAND_TIMEOUT,
            _ => AVATAR_QUERY_TIMEOUT,
        }
    }
}

/// `avatar-rpc` event payload — one in-flight request the webview must answer by id.
#[derive(Serialize, Clone, Debug)]
pub struct AvatarRpcRequest {
    pub id: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/// Validates and parses a raw HTTP request into an `AgentEventPayload`.
///
/// Returns `Err(400)` if method is not POST, path (before any query string) is
/// not `/agent-event`, or the body is not valid JSON for `AgentEventPayload`.
fn parse_request(method: &str, path: &str, body: &str) -> Result<AgentEventPayload, u16> {
    if method != "POST" {
        return Err(400);
    }
    let path_only = path.split('?').next().unwrap_or(path);
    if path_only != "/agent-event" {
        return Err(400);
    }
    serde_json::from_str(body).map_err(|_| 400u16)
}

/// Validates and parses a raw HTTP request into a `signals` array.
///
/// Returns `Err(400)` if method is not POST, path (before any query string) is
/// not `/signals`, or the body is not valid JSON shaped `{"signals": [...]}`.
/// Each element of `signals` is passed through as opaque JSON.
fn parse_signals_request(
    method: &str,
    path: &str,
    body: &str,
) -> Result<Vec<serde_json::Value>, u16> {
    if method != "POST" {
        return Err(400);
    }
    let path_only = path.split('?').next().unwrap_or(path);
    if path_only != "/signals" {
        return Err(400);
    }
    serde_json::from_str::<SignalsRequest>(body)
        .map(|r| r.signals)
        .map_err(|_| 400u16)
}

/// Validates and parses a raw HTTP request into an `AvatarRoute`.
///
/// Returns `Err(404)` for an unknown `/avatar/*` path, and `Err(400)` when the path
/// exists but the method or the command body does not fit it.
fn parse_avatar_request(method: &str, path: &str, body: &str) -> Result<AvatarRoute, u16> {
    let path_only = path.split('?').next().unwrap_or(path);
    match path_only {
        "/avatar/state" => method_gate(method, "GET").map(|()| AvatarRoute::State),
        "/avatar/perch-targets" => method_gate(method, "GET").map(|()| AvatarRoute::PerchTargets),
        "/avatar/command" => method_gate(method, "POST").and_then(|()| {
            serde_json::from_str::<AvatarCommand>(body)
                .map(AvatarRoute::Command)
                .map_err(|_| 400u16)
        }),
        _ => Err(404),
    }
}

fn method_gate(method: &str, expected: &str) -> Result<(), u16> {
    if method == expected {
        Ok(())
    } else {
        Err(400)
    }
}

/// Truncates `summary` to at most `SUMMARY_MAX_BYTES` bytes on a valid UTF-8
/// char boundary and appends a marker. No-op when already within the cap.
fn cap_summary(mut p: AgentEventPayload) -> AgentEventPayload {
    if p.summary.len() > SUMMARY_MAX_BYTES {
        let mut end = SUMMARY_MAX_BYTES;
        while !p.summary.is_char_boundary(end) {
            end -= 1;
        }
        p.summary = format!("{}…[truncated]", &p.summary[..end]);
    }
    p
}

/// Truncates `detail` to at most `DETAIL_MAX_BYTES` bytes on a valid UTF-8
/// char boundary and appends a marker. No-op when absent or already within the cap.
fn cap_detail(mut p: AgentEventPayload) -> AgentEventPayload {
    if let Some(detail) = &p.detail {
        if detail.len() > DETAIL_MAX_BYTES {
            let mut end = DETAIL_MAX_BYTES;
            while !detail.is_char_boundary(end) {
                end -= 1;
            }
            p.detail = Some(format!("{}…[truncated]", &detail[..end]));
        }
    }
    p
}

// ─── Emit helper ──────────────────────────────────────────────────────────────

fn emit_agent_event(app: &AppHandle, payload: AgentEventPayload) {
    let result = app.emit(AGENT_INBOX_CHANNEL, payload);
    if let Err(e) = &result {
        log::warn!("agent_ingress_emit_failed error={e}");
    }
}

fn emit_signals_event(app: &AppHandle, payload: SignalsPayload) {
    let result = app.emit(SIGNALS_INBOX_CHANNEL, payload);
    if let Err(e) = &result {
        log::warn!("agent_ingress_signals_emit_failed error={e}");
    }
}

// ─── Avatar RPC bridge ────────────────────────────────────────────────────────

/// In-flight avatar RPCs, keyed by request id. An entry lives from the emit until
/// either the webview answers or the deadline passes.
fn pending() -> &'static Mutex<HashMap<String, Sender<serde_json::Value>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Sender<serde_json::Value>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn next_rpc_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!("{}-{}", epoch_ms(), SEQ.fetch_add(1, Ordering::Relaxed))
}

fn register_pending(id: &str) -> Receiver<serde_json::Value> {
    let (tx, rx) = channel();
    if let Ok(mut map) = pending().lock() {
        map.insert(id.to_string(), tx);
    }
    rx
}

fn drop_pending(id: &str) {
    if let Ok(mut map) = pending().lock() {
        map.remove(id);
    }
}

/// Hands `result` to the waiting request. `false` means the id is unknown — the
/// request already timed out and gave up.
fn resolve_pending(id: &str, result: serde_json::Value) -> bool {
    let sender = match pending().lock() {
        Ok(mut map) => map.remove(id),
        Err(_) => None,
    };
    match sender {
        Some(tx) => tx.send(result).is_ok(),
        None => false,
    }
}

/// Emits the request into the webview and blocks until it answers or the deadline
/// passes. `Err(503)` covers both an emit failure and a silent webview.
fn avatar_rpc(app: &AppHandle, route: AvatarRoute) -> Result<serde_json::Value, u16> {
    let timeout = route.timeout();
    let (method, params) = route.into_rpc();
    let id = next_rpc_id();
    let rx = register_pending(&id);
    let payload = AvatarRpcRequest {
        id: id.clone(),
        method: method.to_string(),
        params,
    };
    if let Err(e) = app.emit(AVATAR_RPC_CHANNEL, payload) {
        drop_pending(&id);
        log::warn!("avatar_rpc_emit_failed method={method} error={e}");
        return Err(503);
    }
    match rx.recv_timeout(timeout) {
        Ok(value) => Ok(value),
        Err(_) => {
            drop_pending(&id);
            log::warn!("avatar_rpc_timeout method={method} id={id}");
            Err(503)
        }
    }
}

/// Answers an `avatar-rpc` request by id. Called by the webview executor.
#[tauri::command]
pub fn avatar_rpc_response(id: String, result: serde_json::Value) {
    if !resolve_pending(&id, result) {
        log::debug!("avatar_rpc_response_unclaimed id={id}");
    }
}

/// Answers the HTTP request with the bridge outcome — the JSON body, or a bare status.
fn respond_avatar(request: tiny_http::Request, outcome: Result<serde_json::Value, u16>) {
    match outcome {
        Ok(value) => {
            let json = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
            let header =
                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("static header is valid");
            let _ = request.respond(
                tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_status_code(200u16),
            );
        }
        Err(code) => {
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(code));
        }
    }
}

/// Runs the bridge on its own thread so a 15s gesture never stalls the ingress loop.
///
/// The request travels through a shared slot: whichever side ends up owning it answers,
/// so a thread that never starts still returns an explicit 503 instead of tiny_http's
/// drop-time 500.
fn spawn_avatar_request(app: &AppHandle, route: AvatarRoute, request: tiny_http::Request) {
    let app = app.clone();
    let slot = Arc::new(Mutex::new(Some(request)));
    let thread_slot = Arc::clone(&slot);
    let spawned = thread::Builder::new()
        .name("avatar_rpc".into())
        .spawn(move || {
            let taken = thread_slot.lock().ok().and_then(|mut s| s.take());
            if let Some(request) = taken {
                respond_avatar(request, avatar_rpc(&app, route));
            }
        });
    if let Err(e) = spawned {
        log::warn!("avatar_rpc_thread_spawn_failed error={e}");
        let taken = slot.lock().ok().and_then(|mut s| s.take());
        if let Some(request) = taken {
            respond_avatar(request, Err(503));
        }
    }
}

// ─── Request handler ──────────────────────────────────────────────────────────

/// Reads body up to `BODY_CEILING_BYTES`; returns `None` on read error, invalid
/// UTF-8, or a body that exceeds the ceiling.
fn read_body(request: &mut tiny_http::Request) -> Option<String> {
    let reader = request.as_reader();
    let mut body_vec: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if body_vec.len() + n > BODY_CEILING_BYTES {
                    return None; // oversized — drop before growing past the ceiling
                }
                body_vec.extend_from_slice(&buf[..n]);
            }
            Err(_) => return None,
        }
    }
    String::from_utf8(body_vec).ok()
}

fn handle_request(app: &AppHandle, mut request: tiny_http::Request) {
    let method = request.method().to_string();
    let url = request.url().to_string();

    let body = match read_body(&mut request) {
        Some(b) => b,
        None => {
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(400u16));
            log::warn!("agent_ingress_body_read_failed url={url}");
            return;
        }
    };

    let path_only = url.split('?').next().unwrap_or(&url);
    if path_only.starts_with("/avatar/") {
        match parse_avatar_request(&method, &url, &body) {
            Ok(route) => spawn_avatar_request(app, route, request),
            Err(code) => {
                let _ =
                    request.respond(tiny_http::Response::from_string("").with_status_code(code));
                log::warn!("agent_ingress_rejected code={code} method={method} url={url}");
            }
        }
        return;
    }
    let result = match path_only {
        "/agent-event" => parse_request(&method, &url, &body).map(|payload| {
            let payload = cap_detail(cap_summary(payload));
            emit_agent_event(app, payload);
        }),
        "/signals" => parse_signals_request(&method, &url, &body).map(|signals| {
            let payload = SignalsPayload {
                signals,
                ts: epoch_ms(),
            };
            emit_signals_event(app, payload);
        }),
        _ => Err(400),
    };

    match result {
        Ok(()) => {
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(200u16));
        }
        Err(code) => {
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(code));
            log::warn!("agent_ingress_rejected code={code} method={method} url={url}");
        }
    }
}

// ─── Background listener ──────────────────────────────────────────────────────

/// Bind attempts and spacing — a fast restart overlaps the previous process, which frees
/// the port within a couple of seconds.
const BIND_ATTEMPTS: u32 = 8;
const BIND_RETRY_DELAY: Duration = Duration::from_millis(500);

/// Binds the loopback listener, retrying while the port is still taken.
fn bind_with_retry(
    port: u16,
    attempts: u32,
    delay: Duration,
) -> Result<tiny_http::Server, Box<dyn std::error::Error + Send + Sync + 'static>> {
    for attempt in 1..attempts {
        match tiny_http::Server::http(("127.0.0.1", port)) {
            Ok(server) => return Ok(server),
            Err(e) => {
                log::debug!("agent_ingress_bind_retry port={port} attempt={attempt} error={e}")
            }
        }
        thread::sleep(delay);
    }
    tiny_http::Server::http(("127.0.0.1", port))
}

/// Spawns the loopback HTTP listener on the given port.
///
/// Bind failure after the retry window is non-fatal: the app continues without the
/// ingress endpoint.
pub fn start(app: &AppHandle, port: u16) {
    let app = app.clone();
    thread::Builder::new()
        .name("agent_ingress".into())
        .spawn(move || {
            let server = match bind_with_retry(port, BIND_ATTEMPTS, BIND_RETRY_DELAY) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("agent_ingress_bind_failed port={port} error={e}");
                    // The bind retries span ~3.5s, so the webview is normally listening by now.
                    if let Err(e) =
                        app.emit(INGRESS_DEAD_CHANNEL, serde_json::json!({ "port": port }))
                    {
                        log::warn!("agent_ingress_dead_emit_failed error={e}");
                    }
                    return;
                }
            };
            log::debug!("agent_ingress_listening port={port}");
            for request in server.incoming_requests() {
                handle_request(&app, request);
            }
        })
        .expect("failed to spawn agent_ingress thread");
}

/// Starts the loopback ingress on `port` — invoked once at boot with the user's
/// stored port (restart-to-apply; no live rebind). Bind failure is non-fatal.
#[tauri::command]
pub fn start_agent_ingress(app: tauri::AppHandle, port: u16) {
    start(&app, port);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_body() -> &'static str {
        r#"{"tool":"claude-code","project":"YUI","cwd":"/home/user/YUI","phase":"done","summary":"done","ts":1719811200000}"#
    }

    // ── parse_request ─────────────────────────────────────────────────────────

    #[test]
    fn parse_request_valid_returns_payload() {
        let p = parse_request("POST", "/agent-event", valid_body()).unwrap();
        assert_eq!(p.tool, "claude-code");
        assert_eq!(p.project, "YUI");
        assert_eq!(p.cwd, "/home/user/YUI");
        assert_eq!(p.phase, AgentPhase::Done);
        assert_eq!(p.summary, "done");
        assert_eq!(p.ts, 1719811200000);
        assert!(p.status.is_none());
        assert!(p.session_id.is_none());
        assert!(p.detail.is_none());
    }

    #[test]
    fn parse_request_wrong_method_returns_400() {
        assert_eq!(
            parse_request("GET", "/agent-event", valid_body()).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_request_wrong_path_returns_400() {
        assert_eq!(
            parse_request("POST", "/other", valid_body()).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_request_agent_done_route_removed_returns_400() {
        // /agent-done is deleted, not aliased — no backward compat.
        assert_eq!(
            parse_request("POST", "/agent-done", valid_body()).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_request_malformed_json_returns_400() {
        assert_eq!(
            parse_request("POST", "/agent-event", "not json").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_request_missing_phase_returns_400() {
        let body = r#"{"tool":"t","project":"p","cwd":"/","summary":"s","ts":0}"#;
        assert_eq!(
            parse_request("POST", "/agent-event", body).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_request_needs_input_phase_carries_session_id_and_detail() {
        let body = r#"{"tool":"claude-code","project":"p","cwd":"/","phase":"needs_input","session_id":"sess-1","detail":"waiting on Bash: rm -rf /tmp/x","summary":"","ts":1}"#;
        let p = parse_request("POST", "/agent-event", body).unwrap();
        assert_eq!(p.phase, AgentPhase::NeedsInput);
        assert_eq!(p.session_id.as_deref(), Some("sess-1"));
        assert_eq!(p.detail.as_deref(), Some("waiting on Bash: rm -rf /tmp/x"));
    }

    #[test]
    fn parse_request_path_with_query_string_is_accepted() {
        let p = parse_request("POST", "/agent-event?foo=bar", valid_body()).unwrap();
        assert_eq!(p.tool, "claude-code");
    }

    // ── cap_summary ───────────────────────────────────────────────────────────

    fn make_payload(summary: &str) -> AgentEventPayload {
        AgentEventPayload {
            tool: "t".into(),
            project: "p".into(),
            cwd: "/".into(),
            status: None,
            phase: AgentPhase::Done,
            session_id: None,
            detail: None,
            summary: summary.to_string(),
            ts: 0,
        }
    }

    #[test]
    fn cap_summary_under_cap_is_unchanged() {
        let summary = "a".repeat(100);
        let p = cap_summary(make_payload(&summary));
        assert_eq!(p.summary, summary);
    }

    #[test]
    fn cap_summary_over_cap_truncated_with_marker() {
        let summary = "b".repeat(SUMMARY_MAX_BYTES + 100);
        let p = cap_summary(make_payload(&summary));
        // Length bounded: truncated body ≤ cap, plus marker overhead
        assert!(
            p.summary.len() <= SUMMARY_MAX_BYTES + 20,
            "too long: {}",
            p.summary.len()
        );
        assert!(p.summary.ends_with("[truncated]"));
        assert!(std::str::from_utf8(p.summary.as_bytes()).is_ok());
    }

    #[test]
    fn cap_summary_multibyte_safe() {
        // "あ" = 3 bytes. Build a string just over the cap to force a mid-char boundary.
        // SUMMARY_MAX_BYTES / 3 = 2730 r 2, so 2731 chars = 8193 bytes > 8192.
        let summary = "あ".repeat(SUMMARY_MAX_BYTES / 3 + 1);
        let p = cap_summary(make_payload(&summary));
        // Result must be valid UTF-8 (no split codepoints) and contain the marker.
        assert!(std::str::from_utf8(p.summary.as_bytes()).is_ok());
        assert!(p.summary.contains("[truncated]"));
    }

    // ── cap_detail ────────────────────────────────────────────────────────────

    fn make_detail_payload(detail: Option<&str>) -> AgentEventPayload {
        AgentEventPayload {
            tool: "t".into(),
            project: "p".into(),
            cwd: "/".into(),
            status: None,
            phase: AgentPhase::NeedsInput,
            session_id: None,
            detail: detail.map(|d| d.to_string()),
            summary: String::new(),
            ts: 0,
        }
    }

    #[test]
    fn cap_detail_absent_is_unchanged() {
        let p = cap_detail(make_detail_payload(None));
        assert!(p.detail.is_none());
    }

    #[test]
    fn cap_detail_under_cap_is_unchanged() {
        let detail = "a".repeat(100);
        let p = cap_detail(make_detail_payload(Some(&detail)));
        assert_eq!(p.detail.as_deref(), Some(detail.as_str()));
    }

    #[test]
    fn cap_detail_over_cap_truncated_with_marker() {
        let detail = "b".repeat(DETAIL_MAX_BYTES + 100);
        let p = cap_detail(make_detail_payload(Some(&detail)));
        let d = p.detail.unwrap();
        assert!(d.len() <= DETAIL_MAX_BYTES + 20, "too long: {}", d.len());
        assert!(d.ends_with("[truncated]"));
        assert!(std::str::from_utf8(d.as_bytes()).is_ok());
    }

    #[test]
    fn cap_detail_multibyte_safe() {
        // "あ" = 3 bytes. DETAIL_MAX_BYTES / 3 = 5461 r 1, so 5462 chars = 16386 bytes > 16384.
        let detail = "あ".repeat(DETAIL_MAX_BYTES / 3 + 1);
        let p = cap_detail(make_detail_payload(Some(&detail)));
        let d = p.detail.unwrap();
        assert!(std::str::from_utf8(d.as_bytes()).is_ok());
        assert!(d.contains("[truncated]"));
    }

    // ── parse_signals_request ─────────────────────────────────────────────────

    fn valid_signals_body() -> &'static str {
        r#"{"signals":[{"kind":"reminder","payload":{"foo":"bar"}},{"kind":"alert"}]}"#
    }

    #[test]
    fn parse_signals_request_valid_returns_signals() {
        let request = parse_signals_request("POST", "/signals", valid_signals_body()).unwrap();
        assert_eq!(request.signals.len(), 2);
        assert_eq!(request.signals[0]["kind"], "reminder");
        assert_eq!(request.signals[1]["kind"], "alert");
        assert!(request.envelope.is_none());
    }

    #[test]
    fn parse_signals_request_wrong_method_returns_400() {
        assert_eq!(
            parse_signals_request("GET", "/signals", valid_signals_body()).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_signals_request_wrong_path_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/agent-done", valid_signals_body()).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_signals_request_malformed_json_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/signals", "not json").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_signals_request_missing_signals_key_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/signals", r#"{"other":[]}"#).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_signals_request_path_with_query_string_is_accepted() {
        let request =
            parse_signals_request("POST", "/signals?foo=bar", valid_signals_body()).unwrap();
        assert_eq!(request.signals.len(), 2);
    }

    #[test]
    fn parse_signals_request_empty_array_is_accepted() {
        let request = parse_signals_request("POST", "/signals", r#"{"signals":[]}"#).unwrap();
        assert!(request.signals.is_empty());
    }

    #[test]
    fn parse_signals_request_forwards_envelope_verbatim() {
        let request = parse_signals_request(
            "POST",
            "/signals",
            r#"{"signals":[{"id":1}],"envelope":{"source":"n8n","event_type":"workflow_done","delivery":"batched","event_id":"run-8812","occurred_at":1787449000000,"extra":{"opaque":true}}}"#,
        )
        .unwrap();
        assert_eq!(request.envelope.unwrap(), serde_json::json!({
            "source": "n8n",
            "event_type": "workflow_done",
            "delivery": "batched",
            "event_id": "run-8812",
            "occurred_at": 1787449000000_i64,
            "extra": { "opaque": true }
        }));
    }

    #[test]
    fn parse_signals_request_absent_and_null_envelopes_are_omitted() {
        for body in [r#"{"signals":[]}"#, r#"{"signals":[],"envelope":null}"#] {
            let request = parse_signals_request("POST", "/signals", body).unwrap();
            assert!(request.envelope.is_none());
            let payload = SignalsPayload {
                signals: request.signals,
                envelope: request.envelope,
                ts: 1,
            };
            let json = serde_json::to_value(payload).unwrap();
            assert!(!json.as_object().unwrap().contains_key("envelope"));
        }
    }

    // ── handle_request routing (/signals emits signals-inbox) ────────────────

    #[test]
    fn handle_request_routes_signals_and_stamps_ts() {
        let request = parse_signals_request("POST", "/signals", valid_signals_body()).unwrap();
        let payload = SignalsPayload {
            signals: request.signals,
            envelope: request.envelope,
            ts: epoch_ms(),
        };
        assert_eq!(payload.signals.len(), 2);
        assert!(payload.ts > 0);
    }

    #[test]
    fn unknown_path_returns_400() {
        assert_eq!(
            parse_request("POST", "/unknown", valid_body()).unwrap_err(),
            400
        );
        assert_eq!(
            parse_signals_request("POST", "/unknown", valid_signals_body()).unwrap_err(),
            400
        );
    }

    // ── parse_avatar_request ─────────────────────────────────────────────────

    #[test]
    fn parse_avatar_state_requires_get() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/state", "").unwrap(),
            AvatarRoute::State
        );
        assert_eq!(
            parse_avatar_request("POST", "/avatar/state", "").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_perch_targets_requires_get() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/perch-targets", "").unwrap(),
            AvatarRoute::PerchTargets
        );
        assert_eq!(
            parse_avatar_request("POST", "/avatar/perch-targets", "").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_query_path_with_query_string_is_accepted() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/state?foo=bar", "").unwrap(),
            AvatarRoute::State
        );
    }

    #[test]
    fn parse_avatar_unknown_path_returns_404() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/nope", "").unwrap_err(),
            404
        );
    }

    #[test]
    fn parse_avatar_known_path_wrong_method_returns_400() {
        // The route exists, the method does not — a client error, not a missing resource.
        assert_eq!(
            parse_avatar_request("DELETE", "/avatar/state", "").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_requires_post() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/command", r#"{"action":"stand_down"}"#)
                .unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_sit_on_window() {
        let route = parse_avatar_request(
            "POST",
            "/avatar/command",
            r#"{"action":"sit_on_window","app":"Notes"}"#,
        )
        .unwrap();
        assert_eq!(
            route,
            AvatarRoute::Command(AvatarCommand::SitOnWindow {
                app: "Notes".into()
            })
        );
    }

    #[test]
    fn parse_avatar_command_peek_sides() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"peek","side":"left"}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::Peek {
                side: PeekSide::Left
            })
        );
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"peek","side":"right"}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::Peek {
                side: PeekSide::Right
            })
        );
    }

    #[test]
    fn parse_avatar_command_rejects_unknown_peek_side() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"peek","side":"up"}"#
            )
            .unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_move_to_with_and_without_monitor() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"move_to","spot":"center"}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::MoveTo {
                spot: MoveSpot::Center,
                monitor: None
            })
        );
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"move_to","spot":"bottom-right","monitor":1}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::MoveTo {
                spot: MoveSpot::BottomRight,
                monitor: Some(1)
            })
        );
    }

    #[test]
    fn parse_avatar_command_rejects_unknown_spot() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"move_to","spot":"middle"}"#
            )
            .unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_stand_down() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"stand_down"}"#).unwrap(),
            AvatarRoute::Command(AvatarCommand::StandDown)
        );
    }

    #[test]
    fn parse_avatar_command_rejects_unknown_action() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"dance"}"#).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_rejects_malformed_json() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", "not json").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_rejects_missing_app() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"sit_on_window"}"#)
                .unwrap_err(),
            400
        );
    }

    // ── RPC request payload ───────────────────────────────────────────────────

    #[test]
    fn avatar_route_maps_to_method_and_params() {
        let (method, params) = AvatarRoute::State.into_rpc();
        assert_eq!(method, "state");
        assert!(params.is_none());

        let (method, params) = AvatarRoute::PerchTargets.into_rpc();
        assert_eq!(method, "perch_targets");
        assert!(params.is_none());

        let (method, params) = AvatarRoute::Command(AvatarCommand::Peek {
            side: PeekSide::Right,
        })
        .into_rpc();
        assert_eq!(method, "command");
        let params = params.unwrap();
        assert_eq!(params["action"], "peek");
        assert_eq!(params["side"], "right");
    }

    #[test]
    fn avatar_route_timeout_is_shorter_for_queries() {
        assert_eq!(AvatarRoute::State.timeout(), AVATAR_QUERY_TIMEOUT);
        assert_eq!(AvatarRoute::PerchTargets.timeout(), AVATAR_QUERY_TIMEOUT);
        assert_eq!(
            AvatarRoute::Command(AvatarCommand::StandDown).timeout(),
            AVATAR_COMMAND_TIMEOUT
        );
        assert!(AVATAR_QUERY_TIMEOUT < AVATAR_COMMAND_TIMEOUT);
    }

    #[test]
    fn move_to_params_omit_absent_monitor() {
        let (_, params) = AvatarRoute::Command(AvatarCommand::MoveTo {
            spot: MoveSpot::TopLeft,
            monitor: None,
        })
        .into_rpc();
        let params = params.unwrap();
        assert_eq!(params["spot"], "top-left");
        assert!(params.get("monitor").is_none());
    }

    // ── Pending map ───────────────────────────────────────────────────────────

    #[test]
    fn next_rpc_id_is_unique() {
        let a = next_rpc_id();
        let b = next_rpc_id();
        assert_ne!(a, b);
    }

    #[test]
    fn resolve_pending_delivers_result_to_waiter() {
        let id = next_rpc_id();
        let rx = register_pending(&id);
        assert!(resolve_pending(&id, serde_json::json!({"ok": true})));
        let got = rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        assert_eq!(got["ok"], true);
    }

    #[test]
    fn resolve_pending_unknown_id_returns_false() {
        assert!(!resolve_pending("no-such-id", serde_json::Value::Null));
    }

    #[test]
    fn resolve_pending_after_drop_returns_false() {
        let id = next_rpc_id();
        let _rx = register_pending(&id);
        drop_pending(&id);
        assert!(!resolve_pending(&id, serde_json::Value::Null));
    }

    // ── Bind retry ────────────────────────────────────────────────────────────

    #[test]
    fn bind_with_retry_succeeds_once_the_port_is_released() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            drop(holder);
        });
        let server = bind_with_retry(port, 20, Duration::from_millis(50))
            .expect("bind must succeed after the holder releases the port");
        assert_eq!(server.server_addr().to_ip().unwrap().port(), port);
    }

    #[test]
    fn bind_with_retry_gives_up_while_the_port_stays_taken() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        assert!(bind_with_retry(port, 2, Duration::from_millis(10)).is_err());
    }

    #[test]
    fn pending_receiver_times_out_when_unanswered() {
        let id = next_rpc_id();
        let rx = register_pending(&id);
        assert!(rx
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        drop_pending(&id);
    }
}
