use super::payload::{AvatarRoute, AvatarRpcRequest, AVATAR_RPC_CHANNEL};
use crate::os_event_watcher::epoch_ms;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

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
pub(super) fn spawn_avatar_request(
    app: &AppHandle,
    route: AvatarRoute,
    request: tiny_http::Request,
) {
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

#[cfg(test)]
mod tests {
    use super::*;

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
