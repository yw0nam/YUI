use super::super::response::{respond_json, HttpResponse};
use super::routes::ThreadRoute;
use super::waits::WaitSlots;
use crate::os_event_watcher::epoch_ms;
use crate::threads::store::{ThreadStore, WaitOutcome};
use std::sync::Arc;

static WAITS: WaitSlots = WaitSlots::new();

pub(in crate::agent_ingress) async fn handle(
    store: Arc<ThreadStore>,
    route: ThreadRoute,
) -> HttpResponse {
    let outcome = match route {
        ThreadRoute::Upsert { id, body } => {
            let updated_at = store.upsert(&id, body, epoch_ms() as u64);
            Ok(serde_json::json!({"updated_at": updated_at}))
        }
        ThreadRoute::Answer { id, ask_id, wait } => {
            let Some(permit) = WAITS.acquire() else {
                return respond_json(Err(503));
            };
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                match store.wait_answer(&id, ask_id.as_deref(), wait) {
                    WaitOutcome::Answer(answer) => {
                        Ok(serde_json::to_value(answer).expect("answer serializes"))
                    }
                    WaitOutcome::NoAnswer => Err(204),
                    WaitOutcome::Gone => Err(410),
                    WaitOutcome::Unknown => Err(404),
                }
            })
            .await
            .unwrap_or(Err(503))
        }
        ThreadRoute::Sweep { source } => {
            let answers = store.drain_answers(&source);
            Ok(serde_json::json!({ "answers": answers }))
        }
    };
    respond_json(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_ingress::transport_tests::Server;
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};

    #[test]
    fn disconnected_answer_clients_hold_slots_until_the_wait_returns() {
        let server = Server::start();
        server.store.upsert(
            "t",
            crate::threads::model::parse_upsert(
                r#"{"source":"test","title":"Wait","state":"working","entries":[]}"#,
            )
            .unwrap(),
            1,
        );
        let mut clients = Vec::new();
        for _ in 0..32 {
            let mut stream = server.connect();
            stream
                .write_all(b"GET /threads/t/answer?wait=2 HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            clients.push(stream);
        }
        let start = Instant::now();
        while WAITS.acquire().is_some() && start.elapsed() < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(
            WAITS.acquire().is_none(),
            "32 requests occupy the wait slots"
        );
        drop(clients);
        server.wait_capacity(64);
        assert!(
            WAITS.acquire().is_none(),
            "disconnect does not release a blocking wait permit"
        );
        let poll = || {
            let mut stream = server.connect();
            stream
                .write_all(b"GET /threads/t/answer?wait=0 HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            let mut result = String::new();
            stream.read_to_string(&mut result).unwrap();
            result
        };
        assert!(poll().starts_with("HTTP/1.1 503"));
        let start = Instant::now();
        while WAITS.acquire().is_none() && start.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            WAITS.acquire().is_some(),
            "the completed wait releases its permit"
        );
        assert!(poll().starts_with("HTTP/1.1 204"));
    }
}
