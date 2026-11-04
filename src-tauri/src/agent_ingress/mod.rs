//! Loopback HTTP ingress — receives opaque `signals` batches from outside
//! producers, then re-emits them as Tauri events into the frontend dispatcher;
//! `/presets/<id>/` delivers to `pet-<id>`.
//!
//! Also serves the avatar RPC surface (`/avatar/*`): body state, perch targets, and
//! semantic movement commands. Those live in the webview, so each request is bridged
//! as an `avatar-rpc` event and answered by the `avatar_rpc_response` command.
//!
//! Binds loopback only; no auth (single-user desktop).

use payload::{SignalsPayload, SIGNALS_INBOX_CHANNEL};
use response::{status, HttpResponse};
use route::{Dispatch, RouteKind};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub(crate) mod avatar_rpc;
mod guard;
mod payload;
mod response;
mod route;
mod server;
mod threads;

/// Preset ids main publishes for distinguishing closed windows from unknown presets.
#[derive(Default)]
pub struct PresetIds(Mutex<HashSet<String>>);
impl PresetIds {
    fn replace(&self, label: &str, ids: Vec<String>) -> Result<(), String> {
        if label != INGRESS_WINDOW {
            log::warn!("preset_ids_sync_refused reason=foreign_window label={label}");
            return Err("only main may sync preset ids".into());
        }
        if ids.iter().any(String::is_empty) {
            log::warn!("preset_ids_sync_refused reason=empty_id");
            return Err("preset ids must not be empty".into());
        }
        let ids: HashSet<_> = ids.into_iter().collect();
        let count = ids.len();
        *self.0.lock().map_err(|e| e.to_string())? = ids;
        log::debug!("preset_ids_synced count={count}");
        Ok(())
    }
}

/// Replaces the known preset ids after verifying the invoking window is main.
#[tauri::command]
pub fn sync_preset_ids(
    window: tauri::Window,
    state: State<'_, PresetIds>,
    ids: Vec<String>,
) -> Result<(), String> {
    state.replace(window.label(), ids)
}

// ─── Emit helper ──────────────────────────────────────────────────────────────

fn emit_signals_event(app: &AppHandle, label: &str, payload: SignalsPayload) {
    log::debug!(
        "agent_ingress_signals_accepted event_id={:?}",
        payload.envelope["event_id"].as_str().unwrap_or_default()
    );
    let result = app.emit_to(label, SIGNALS_INBOX_CHANNEL, payload);
    if let Err(e) = &result {
        log::warn!("agent_ingress_signals_emit_failed error={e}");
    }
}

// ─── Request handler ──────────────────────────────────────────────────────────

async fn handle_request(
    app: &AppHandle,
    request: hyper::Request<hyper::body::Incoming>,
) -> HttpResponse {
    let result = server::route_request(
        request,
        |id| {
            Ok(app
                .state::<PresetIds>()
                .0
                .lock()
                .map_err(|_| 503u16)?
                .contains(id))
        },
        |label| app.get_webview_window(label).is_some(),
    )
    .await;
    let Dispatch { label, kind } = match result {
        Ok(route) => route,
        Err(code) => return status(code),
    };
    match kind {
        RouteKind::Thread(route) => {
            threads::requests::handle(
                app.state::<std::sync::Arc<crate::threads::store::ThreadStore>>()
                    .inner()
                    .clone(),
                route,
            )
            .await
        }
        RouteKind::Avatar(route) => {
            response::respond_json(avatar_rpc::avatar_rpc(app, &label, route).await)
        }
        RouteKind::Signals(payload) => {
            emit_signals_event(app, &label, payload);
            status(200)
        }
    }
}

/// Main owns the bare routes and ingress lifecycle notifications.
const INGRESS_WINDOW: &str = "main";

/// Starts the loopback ingress on `port` at boot; a failed bind is non-fatal.
#[tauri::command]
pub fn start_agent_ingress(app: tauri::AppHandle, port: u16) {
    server::start(&app, port);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_ids_refuses_foreign_callers_and_invalid_ids() {
        let state = PresetIds::default();
        assert!(state.replace("pet-a", vec!["a".into()]).is_err());
        assert!(state.replace("main", vec![String::new()]).is_err());
        assert!(state.0.lock().unwrap().is_empty());
        state.replace("main", vec!["a".into()]).unwrap();
        state.replace("main", vec!["b".into()]).unwrap();
        assert_eq!(
            *state.0.lock().unwrap(),
            std::collections::HashSet::from(["b".into()])
        );
    }
}

#[cfg(test)]
mod transport_tests;
