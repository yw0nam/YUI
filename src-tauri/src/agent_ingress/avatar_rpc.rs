use super::payload::{AvatarRoute, AvatarRpcRequest, AVATAR_RPC_CHANNEL};
use crate::os_event_watcher::epoch_ms;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot::{channel, Receiver, Sender};

/// Each pending RPC belongs to its target window until resolution, timeout, or cancellation.
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

/// Emits into the webview and waits for its answer; failure or timeout returns 503.
pub(super) async fn avatar_rpc(
    app: &AppHandle,
    label: &str,
    route: AvatarRoute,
) -> Result<serde_json::Value, u16> {
    request_avatar(label, route, |payload| {
        app.emit_to(label, AVATAR_RPC_CHANNEL, payload)
    })
    .await
}

async fn request_avatar<E: std::fmt::Display>(
    label: &str,
    route: AvatarRoute,
    emit: impl FnOnce(AvatarRpcRequest) -> Result<(), E>,
) -> Result<serde_json::Value, u16> {
    let timeout = route.timeout();
    let (method, params) = route.into_rpc();
    let id = next_rpc_id();
    let rx = register_pending(&id, label);
    let _pending = PendingRequest(id.clone());
    let payload = AvatarRpcRequest {
        id: id.clone(),
        method: method.to_string(),
        params,
    };
    if let Err(e) = emit(payload) {
        log::warn!("avatar_rpc_emit_failed method={method} error={e}");
        return Err(503);
    }
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(value)) => Ok(value),
        _ => {
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

struct PendingRequest(String);

impl Drop for PendingRequest {
    fn drop(&mut self) {
        drop_pending(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Pending map ───────────────────────────────────────────────────────────

    #[test]
    fn foreign_response_leaves_request_for_its_target() {
        let id = next_rpc_id();
        let mut rx = register_pending(&id, "pet-a");
        assert!(!resolve_pending(&id, "main", serde_json::Value::Null));
        assert!(rx.try_recv().is_err());
        assert!(resolve_pending(
            &id,
            "pet-a",
            serde_json::json!({"ok":true})
        ));
        assert_eq!(rx.blocking_recv().unwrap()["ok"], true);
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
        let got = rx.blocking_recv().unwrap();
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

    #[tokio::test]
    async fn canceled_avatar_request_removes_its_pending_entry() {
        let (sent, received) = channel();
        let request = tokio::spawn(request_avatar("main", AvatarRoute::State, |payload| {
            sent.send(payload.id).unwrap();
            Ok::<_, &str>(())
        }));
        let id = received.await.unwrap();
        request.abort();
        assert!(request.await.unwrap_err().is_cancelled());
        assert!(!resolve_pending(&id, "main", serde_json::Value::Null));
    }

    #[tokio::test]
    async fn pending_receiver_times_out_when_unanswered() {
        let id = next_rpc_id();
        let rx = register_pending(&id, "main");
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), rx)
                .await
                .is_err()
        );
        drop_pending(&id);
    }
}
