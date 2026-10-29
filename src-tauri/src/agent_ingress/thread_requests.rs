use super::response::respond_json;
use super::thread_routes::ThreadRoute;
use super::thread_waits::WaitSlots;
use crate::os_event_watcher::epoch_ms;
use crate::threads::store::{ThreadStore, WaitOutcome};
use std::sync::{Arc, Mutex};
use std::thread;

static WAITS: WaitSlots = WaitSlots::new();

pub(super) fn handle(store: Arc<ThreadStore>, route: ThreadRoute, request: tiny_http::Request) {
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
            let slot = Arc::new(Mutex::new(Some(request)));
            let thread_slot = slot.clone();
            let spawned = thread::Builder::new()
                .name("threads_answer".into())
                .spawn(move || {
                    let _permit = permit;
                    let taken = thread_slot.lock().unwrap().take();
                    if let Some(request) = taken {
                        let result = match store.wait_answer(&id, &ask_id, wait) {
                            WaitOutcome::Answer(answer) => {
                                Ok(serde_json::to_value(answer).expect("answer serializes"))
                            }
                            WaitOutcome::NoAnswer => Err(204),
                            WaitOutcome::Gone => Err(410),
                            WaitOutcome::Unknown => Err(404),
                        };
                        respond_json(request, result);
                    }
                });
            if let Err(error) = spawned {
                log::warn!("threads_wait_spawn_failed error={error}");
                if let Some(request) = slot.lock().unwrap().take() {
                    respond_json(request, Err(503));
                }
            }
        }
    }
}
