use super::payload::{AvatarRoute, AvatarRpcRequest, AVATAR_RPC_CHANNEL};
use super::response::{respond_json, spawn_request};
use crate::os_event_watcher::epoch_ms;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// In-flight avatar RPCs, keyed by request id. An entry lives from the emit until
/// either the webview answers or the deadline passes.
type Pending = HashMap<String, (String, Sender<serde_json::Value>)>;

fn pending() -> &'static Mutex<Pending> {
    static PENDING: OnceLock<Mutex<Pending>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn next_rpc_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!("{}-{}", epoch_ms(), SEQ.fetch_add(1, Ordering::Relaxed))
}

fn register_pending(id: &str, label: &str) -> Receiver<serde_json::Value> {
    let (tx, rx) = channel();
    if let Ok(mut map) = pending().lock() {
        map.insert(id.to_string(), (label.into(), tx));
    }
    rx
}

fn drop_pending(id: &str) {
    if let Ok(mut map) = pending().lock() {
        map.remove(id);
    }
}

/// Delivers a result only to a pending request owned by the calling window.
fn resolve_pending(id: &str, label: &str, result: serde_json::Value) -> bool {
    let sender = match pending().lock() {
        Ok(mut map) => {
            if let Some((target, _)) = map.get(id) {
                if target != label {
                    log::warn!(
                        "avatar_rpc_response_foreign_window id={id} label={label} target={target}"
                    );
                    return false;
                }
            }
            map.remove(id).map(|(_, sender)| sender)
        }
        Err(_) => None,
    };
    let delivered = match sender {
        Some(tx) => tx.send(result).is_ok(),
        None => false,
    };
    if !delivered {
        log::debug!("avatar_rpc_response_unclaimed id={id}");
    }
    delivered
}

/// Emits the request into the webview and blocks until it answers or the deadline
/// passes. `Err(503)` covers both an emit failure and a silent webview.
fn avatar_rpc(app: &AppHandle, label: &str, route: AvatarRoute) -> Result<serde_json::Value, u16> {
    let timeout = route.timeout();
    let (method, params) = route.into_rpc();
    let id = next_rpc_id();
    let rx = register_pending(&id, label);
    let payload = AvatarRpcRequest {
        id: id.clone(),
        method: method.to_string(),
        params,
    };
    if let Err(e) = app.emit_to(label, AVATAR_RPC_CHANNEL, payload) {
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
pub fn avatar_rpc_response(window: tauri::Window, id: String, result: serde_json::Value) {
    resolve_pending(&id, window.label(), result);
}

/// Runs the avatar RPC off the ingress accept loop.
pub(super) fn spawn_avatar_request(
    app: &AppHandle,
    label: &str,
    route: AvatarRoute,
    request: tiny_http::Request,
) {
    let app = app.clone();
    let label = label.to_string();
    spawn_response("avatar_rpc", request, move || {
        avatar_rpc(&app, &label, route)
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Pending map ───────────────────────────────────────────────────────────

    #[test]
    fn foreign_response_leaves_request_for_its_target() {
        let id = next_rpc_id();
        let rx = register_pending(&id, "pet-a");
        assert!(!resolve_pending(&id, "main", serde_json::Value::Null));
        assert!(rx.try_recv().is_err());
        assert!(resolve_pending(
            &id,
            "pet-a",
            serde_json::json!({"ok":true})
        ));
        assert_eq!(rx.recv().unwrap()["ok"], true);
    }

    #[test]
    fn next_rpc_id_is_unique() {
        let a = next_rpc_id();
        let b = next_rpc_id();
        assert_ne!(a, b);
    }

    #[test]
    fn resolve_pending_delivers_result_to_waiter() {
        let id = next_rpc_id();
        let rx = register_pending(&id, "main");
        assert!(resolve_pending(
            &id,
            "main",
            serde_json::json!({"ok": true})
        ));
        let got = rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        assert_eq!(got["ok"], true);
    }

    #[test]
    fn resolve_pending_unknown_id_returns_false() {
        assert!(!resolve_pending(
            "no-such-id",
            "main",
            serde_json::Value::Null
        ));
    }

    #[test]
    fn resolve_pending_after_drop_returns_false() {
        let id = next_rpc_id();
        let _rx = register_pending(&id, "main");
        drop_pending(&id);
        assert!(!resolve_pending(&id, "main", serde_json::Value::Null));
    }

    #[test]
    fn pending_receiver_times_out_when_unanswered() {
        let id = next_rpc_id();
        let rx = register_pending(&id, "main");
        assert!(rx
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        drop_pending(&id);
    }
}
