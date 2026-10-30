//! Shared JSON responses and off-thread request ownership for the ingress.

use std::sync::{Arc, Mutex, PoisonError};
use std::thread;

pub(super) fn respond_json(request: tiny_http::Request, outcome: Result<serde_json::Value, u16>) {
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

// The slot preserves the request for a 503 response when spawning fails.
pub(super) fn spawn_request(
    name: &'static str,
    request: tiny_http::Request,
    work: impl FnOnce(tiny_http::Request) + Send + 'static,
) {
    let slot = Arc::new(Mutex::new(Some(request)));
    let thread_slot = slot.clone();
    let spawned = thread::Builder::new().name(name.into()).spawn(move || {
        let taken = thread_slot
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(request) = taken {
            work(request);
        }
    });
    if let Err(error) = spawned {
        log::warn!("ingress_response_spawn_failed worker={name} error={error}");
        let taken = slot.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(request) = taken {
            respond_json(request, Err(503));
        }
    }
}
