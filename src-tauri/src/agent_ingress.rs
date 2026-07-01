//! Loopback HTTP ingress — receives "work done" signals from external coding-agent
//! finish-hooks and re-emits them as Tauri events into the frontend dispatcher.
//!
//! Binds loopback only; no auth (single-user desktop).

use serde::{Deserialize, Serialize};
use std::thread;
use tauri::{AppHandle, Emitter};

pub const AGENT_INBOX_CHANNEL: &str = "agent-inbox";

const SUMMARY_MAX_BYTES: usize = 8192;
const PORT: u16 = 8770;
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

    match parse_request(&method, &url, &body) {
        Ok(payload) => {
            let payload = cap_summary(payload);
            emit_agent_event(app, payload);
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(200u16));
        }
        Err(code) => {
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(code));
            log::warn!("agent_ingress_rejected code={code} method={method} url={url}");
        }
    }
}

// ─── Background listener ──────────────────────────────────────────────────────

/// Spawns the loopback HTTP listener on port 8770.
///
/// Bind failure is non-fatal: the app continues without the ingress endpoint.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::Builder::new()
        .name("agent_ingress".into())
        .spawn(move || {
            let server = match tiny_http::Server::http(("127.0.0.1", PORT)) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("agent_ingress_bind_failed port={PORT} error={e}");
                    return;
                }
            };
            log::debug!("agent_ingress_listening port={PORT}");
            for request in server.incoming_requests() {
                handle_request(&app, request);
            }
        })
        .expect("failed to spawn agent_ingress thread");
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
        assert_eq!(parse_request("GET", "/agent-done", valid_body()).unwrap_err(), 400);
    }

    #[test]
    fn parse_request_wrong_path_returns_400() {
        assert_eq!(parse_request("POST", "/other", valid_body()).unwrap_err(), 400);
    }

    #[test]
    fn parse_request_malformed_json_returns_400() {
        assert_eq!(parse_request("POST", "/agent-done", "not json").unwrap_err(), 400);
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
        assert!(p.summary.len() <= SUMMARY_MAX_BYTES + 20, "too long: {}", p.summary.len());
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
}
