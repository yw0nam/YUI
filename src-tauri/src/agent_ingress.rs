//! Loopback HTTP ingress — receives "work done" signals from external coding-agent
//! finish-hooks and opaque `signals` batches from the remote n8n workflow, then
//! re-emits both as Tauri events into the frontend dispatcher.
//!
//! Binds loopback only; no auth (single-user desktop).

use crate::os_event_watcher::epoch_ms;
use serde::{Deserialize, Serialize};
use std::thread;
use tauri::{AppHandle, Emitter};

pub const AGENT_INBOX_CHANNEL: &str = "agent-inbox";
pub const SIGNALS_INBOX_CHANNEL: &str = "signals-inbox";

const SUMMARY_MAX_BYTES: usize = 8192;
/// Hard body read ceiling; prevents OOM on oversized payloads.
const BODY_CEILING_BYTES: usize = 65536; // 8× summary cap

/// `agent-inbox` event payload — fired when an external agent posts to /agent-done.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct AgentDonePayload {
    pub tool: String,
    pub project: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>, // "success" | "error" | absent
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

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/// Validates and parses a raw HTTP request into an `AgentDonePayload`.
///
/// Returns `Err(400)` if method is not POST, path (before any query string) is
/// not `/agent-done`, or the body is not valid JSON for `AgentDonePayload`.
fn parse_request(method: &str, path: &str, body: &str) -> Result<AgentDonePayload, u16> {
    if method != "POST" {
        return Err(400);
    }
    let path_only = path.split('?').next().unwrap_or(path);
    if path_only != "/agent-done" {
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

/// Truncates `summary` to at most `SUMMARY_MAX_BYTES` bytes on a valid UTF-8
/// char boundary and appends a marker. No-op when already within the cap.
fn cap_summary(mut p: AgentDonePayload) -> AgentDonePayload {
    if p.summary.len() > SUMMARY_MAX_BYTES {
        let mut end = SUMMARY_MAX_BYTES;
        while !p.summary.is_char_boundary(end) {
            end -= 1;
        }
        p.summary = format!("{}…[truncated]", &p.summary[..end]);
    }
    p
}

// ─── Emit helper ──────────────────────────────────────────────────────────────

fn emit_agent_event(app: &AppHandle, payload: AgentDonePayload) {
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
    let result = match path_only {
        "/agent-done" => parse_request(&method, &url, &body).map(|payload| {
            let payload = cap_summary(payload);
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

/// Spawns the loopback HTTP listener on the given port.
///
/// Bind failure is non-fatal: the app continues without the ingress endpoint.
pub fn start(app: &AppHandle, port: u16) {
    let app = app.clone();
    thread::Builder::new()
        .name("agent_ingress".into())
        .spawn(move || {
            let server = match tiny_http::Server::http(("127.0.0.1", port)) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("agent_ingress_bind_failed port={port} error={e}");
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
        r#"{"tool":"claude-code","project":"YUI","cwd":"/home/user/YUI","summary":"done","ts":1719811200000}"#
    }

    // ── parse_request ─────────────────────────────────────────────────────────

    #[test]
    fn parse_request_valid_returns_payload() {
        let p = parse_request("POST", "/agent-done", valid_body()).unwrap();
        assert_eq!(p.tool, "claude-code");
        assert_eq!(p.project, "YUI");
        assert_eq!(p.cwd, "/home/user/YUI");
        assert_eq!(p.summary, "done");
        assert_eq!(p.ts, 1719811200000);
        assert!(p.status.is_none());
    }

    #[test]
    fn parse_request_wrong_method_returns_400() {
        assert_eq!(
            parse_request("GET", "/agent-done", valid_body()).unwrap_err(),
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
    fn parse_request_malformed_json_returns_400() {
        assert_eq!(
            parse_request("POST", "/agent-done", "not json").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_request_path_with_query_string_is_accepted() {
        let p = parse_request("POST", "/agent-done?foo=bar", valid_body()).unwrap();
        assert_eq!(p.tool, "claude-code");
    }

    // ── cap_summary ───────────────────────────────────────────────────────────

    fn make_payload(summary: &str) -> AgentDonePayload {
        AgentDonePayload {
            tool: "t".into(),
            project: "p".into(),
            cwd: "/".into(),
            status: None,
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

    // ── parse_signals_request ─────────────────────────────────────────────────

    fn valid_signals_body() -> &'static str {
        r#"{"signals":[{"kind":"reminder","payload":{"foo":"bar"}},{"kind":"alert"}]}"#
    }

    #[test]
    fn parse_signals_request_valid_returns_signals() {
        let signals = parse_signals_request("POST", "/signals", valid_signals_body()).unwrap();
        assert_eq!(signals.len(), 2);
        assert_eq!(signals[0]["kind"], "reminder");
        assert_eq!(signals[1]["kind"], "alert");
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
        let signals =
            parse_signals_request("POST", "/signals?foo=bar", valid_signals_body()).unwrap();
        assert_eq!(signals.len(), 2);
    }

    #[test]
    fn parse_signals_request_empty_array_is_accepted() {
        let signals = parse_signals_request("POST", "/signals", r#"{"signals":[]}"#).unwrap();
        assert!(signals.is_empty());
    }

    // ── handle_request routing (/signals emits signals-inbox) ────────────────

    #[test]
    fn handle_request_routes_signals_and_stamps_ts() {
        let signals = parse_signals_request("POST", "/signals", valid_signals_body()).unwrap();
        let payload = SignalsPayload {
            signals,
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
    fn parse_avatar_unknown_path_returns_400() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/nope", "").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_requires_post() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/command", r#"{"action":"stand_down"}"#).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_sit_on_window() {
        let route =
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"sit_on_window","app":"Notes"}"#)
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
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"peek","side":"left"}"#).unwrap(),
            AvatarRoute::Command(AvatarCommand::Peek {
                side: PeekSide::Left
            })
        );
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"peek","side":"right"}"#).unwrap(),
            AvatarRoute::Command(AvatarCommand::Peek {
                side: PeekSide::Right
            })
        );
    }

    #[test]
    fn parse_avatar_command_rejects_unknown_peek_side() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"peek","side":"up"}"#).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_move_to_with_and_without_monitor() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"move_to","spot":"center"}"#)
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
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"move_to","spot":"middle"}"#)
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
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"sit_on_window"}"#).unwrap_err(),
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
