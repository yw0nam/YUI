use super::super::response::{respond_json, HttpResponse};
use super::routes::ThreadRoute;
use crate::os_event_watcher::epoch_ms;
use crate::threads::store::ThreadStore;
use std::sync::Arc;

pub(in crate::agent_ingress) async fn handle(
    store: Arc<ThreadStore>,
    route: ThreadRoute,
) -> HttpResponse {
    let updated_at = store.upsert(&route.id, route.body, epoch_ms() as u64);
    respond_json(Ok(serde_json::json!({"updated_at": updated_at})))
}
