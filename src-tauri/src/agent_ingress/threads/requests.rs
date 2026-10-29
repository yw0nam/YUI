use super::super::response::{respond_json, spawn_request};
use super::routes::ThreadRoute;
use super::waits::WaitSlots;
use crate::os_event_watcher::epoch_ms;
use crate::threads::store::{ThreadStore, WaitOutcome};
use std::sync::Arc;

static WAITS: WaitSlots = WaitSlots::new();

pub(in crate::agent_ingress) fn handle(
    store: Arc<ThreadStore>,
    route: ThreadRoute,
    request: tiny_http::Request,
) {
    match route {
        ThreadRoute::Upsert { id, body } => {
            let updated_at = store.upsert(&id, body, epoch_ms() as u64);
            respond_json(request, Ok(serde_json::json!({"updated_at": updated_at})));
        }
        ThreadRoute::Answer { id, ask_id, wait } => {
            let Some(permit) = WAITS.acquire() else {
                respond_json(request, Err(503));
                return;
            };
            spawn_request("threads_answer", request, move |request| {
                let _permit = permit;
                let result = match store.wait_answer(&id, ask_id.as_deref(), wait) {
                    WaitOutcome::Answer(answer) => {
                        Ok(serde_json::to_value(answer).expect("answer serializes"))
                    }
                    WaitOutcome::NoAnswer => Err(204),
                    WaitOutcome::Gone => Err(410),
                    WaitOutcome::Unknown => Err(404),
                };
                respond_json(request, result);
            });
        }
        ThreadRoute::Sweep { .. } => unreachable!("the sweep route is not parsed yet"),
    }
}
