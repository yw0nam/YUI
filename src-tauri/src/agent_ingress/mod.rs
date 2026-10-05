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
use avatar_rpc::spawn_avatar_request;
use payload::{
    cap_detail, cap_summary, parse_avatar_request, parse_request, parse_signals_request,
    rejected_level, AgentEventPayload, SignalsPayload, AGENT_INBOX_CHANNEL, BODY_CEILING_BYTES,
    INGRESS_DEAD_CHANNEL, SIGNALS_INBOX_CHANNEL,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub(crate) mod avatar_rpc;
mod payload;

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
                log::log!(
                    rejected_level(code),
                    "agent_ingress_rejected code={code} method={method} url={url}"
                );
            }
        }
        return;
    }
    let result = match path_only {
        "/agent-event" => parse_request(&method, &url, &body).map(|payload| {
            let payload = cap_detail(cap_summary(payload));
            emit_agent_event(app, payload);
        }),
        "/signals" => parse_signals_request(&method, &url, &body).and_then(|request| {
            let payload = SignalsPayload {
                signals: request.signals,
                envelope: request.envelope.ok_or(400u16)?,
                ts: epoch_ms(),
            };
            emit_signals_event(app, payload);
            Ok(())
        }),
        _ => Err(400),
    };

    match result {
        Ok(()) => {
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(200u16));
        }
        Err(code) => {
            let _ = request.respond(tiny_http::Response::from_string("").with_status_code(code));
            log::log!(
                rejected_level(code),
                "agent_ingress_rejected code={code} method={method} url={url}"
            );
        }
    }
}

// ─── Background listener ──────────────────────────────────────────────────────

/// Bind attempts and spacing — a fast restart overlaps the previous process, which frees
/// the port within a couple of seconds.
const BIND_ATTEMPTS: u32 = 8;
const BIND_RETRY_DELAY: Duration = Duration::from_millis(500);

/// Set while this process owns the ingress listener.
static LISTENER_CLAIMED: AtomicBool = AtomicBool::new(false);

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

/// Binds the listener unless this process already claimed it; a failed bind releases the claim.
/// `None` means another call holds the claim.
fn claim_and_bind(
    claim: &AtomicBool,
    port: u16,
    attempts: u32,
    delay: Duration,
) -> Option<Result<tiny_http::Server, Box<dyn std::error::Error + Send + Sync + 'static>>> {
    if claim.swap(true, Ordering::SeqCst) {
        return None;
    }
    let result = bind_with_retry(port, attempts, delay);
    if result.is_err() {
        claim.store(false, Ordering::SeqCst);
    }
    Some(result)
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
            let server =
                match claim_and_bind(&LISTENER_CLAIMED, port, BIND_ATTEMPTS, BIND_RETRY_DELAY) {
                    // A page reload calls start again while an earlier call holds the listener.
                    None => {
                        log::debug!("agent_ingress_start_skipped requested_port={port}");
                        return;
                    }
                    Some(Ok(s)) => s,
                    Some(Err(e)) => {
                        log::warn!("agent_ingress_bind_failed port={port} error={e}");
                        // Reaches the page that is loaded when the retries end; a reload inside that window misses it.
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

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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

    // ── Listener claim ────────────────────────────────────────────────────

    #[test]
    fn claim_and_bind_skips_when_already_claimed() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        drop(holder);
        let claim = AtomicBool::new(true);
        assert!(claim_and_bind(&claim, port, 1, Duration::ZERO).is_none());
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn claim_and_bind_releases_the_claim_when_bind_fails() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        let claim = AtomicBool::new(false);
        let result = claim_and_bind(&claim, port, 2, Duration::from_millis(10));
        assert!(matches!(result, Some(Err(_))));
        assert!(!claim.load(Ordering::SeqCst));
    }

    #[test]
    fn claim_and_bind_keeps_the_claim_after_a_bind() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        drop(holder);
        let claim = AtomicBool::new(false);
        assert!(matches!(
            claim_and_bind(&claim, port, 1, Duration::ZERO),
            Some(Ok(_))
        ));
        assert!(claim.load(Ordering::SeqCst));
        assert!(claim_and_bind(&claim, port, 1, Duration::ZERO).is_none());
    }
}
