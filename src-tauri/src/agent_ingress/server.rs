//! Bounded HTTP/1 transport on the ingress thread.

use super::payload::{rejected_level, BODY_CEILING_BYTES, INGRESS_DEAD_CHANNEL};
use super::response::HttpResponse;
use super::route::{dispatch, Dispatch};
use super::{guard, handle_request, INGRESS_WINDOW};
use http_body_util::BodyExt;
use hyper::{body::Incoming, server::conn::http1, service::service_fn, Request};
use hyper_util::rt::{TokioIo, TokioTimer};
use std::convert::Infallible;
use std::future::Future;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::{net::TcpListener, sync::Semaphore};

const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(5);
const BODY_DEADLINE: Duration = Duration::from_secs(10);
pub(super) const CONNECTION_LIMIT: usize = 64;
const BIND_ATTEMPTS: u32 = 8;
const BIND_RETRY_DELAY: Duration = Duration::from_millis(500);
static LISTENER_CLAIMED: AtomicBool = AtomicBool::new(false);

async fn read_body(mut body: Incoming) -> Option<String> {
    tokio::time::timeout(BODY_DEADLINE, async {
        let mut bytes = Vec::new();
        while let Some(frame) = body.frame().await {
            let frame = frame.ok()?;
            if let Ok(data) = frame.into_data() {
                if bytes.len() + data.len() > BODY_CEILING_BYTES {
                    return None;
                }
                bytes.extend_from_slice(&data);
            }
        }
        String::from_utf8(bytes).ok()
    })
    .await
    .ok()
    .flatten()
}

pub(super) async fn route_request(
    request: Request<Incoming>,
    is_known: impl Fn(&str) -> Result<bool, u16>,
    window_exists: impl Fn(&str) -> bool,
) -> Result<Dispatch, u16> {
    let method = request.method().to_string();
    let url = request
        .uri()
        .path_and_query()
        .map_or("/", |path| path.as_str())
        .to_string();
    if let Some(code) = guard::refuse(request.headers()) {
        log::warn!("agent_ingress_refused code={code} method={method} url={url}");
        return Err(code);
    }
    let result = match read_body(request.into_body()).await {
        Some(body) => dispatch(&method, &url, &body, is_known, window_exists),
        None => {
            log::warn!("agent_ingress_body_read_failed url={url}");
            Err(400)
        }
    };
    if let Err(code) = result {
        log::log!(
            rejected_level(code),
            "agent_ingress_rejected code={code} method={method} url={url}"
        );
    }
    result
}

pub(super) async fn serve<F, Fut>(
    listener: TcpListener,
    connections: Arc<Semaphore>,
    handler: F,
) -> std::io::Result<()>
where
    F: Fn(Request<Incoming>) -> Fut + Clone + Send + 'static,
    Fut: Future<Output = HttpResponse> + Send,
{
    loop {
        let (stream, _) = listener.accept().await?;
        let Ok(permit) = connections.clone().try_acquire_owned() else {
            drop(stream);
            continue;
        };
        let handler = handler.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let service = service_fn(move |request| {
                let response = handler(request);
                async move { Ok::<_, Infallible>(response.await) }
            });
            let _ = http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(HEADER_READ_TIMEOUT)
                .keep_alive(false)
                .serve_connection(TokioIo::new(stream), service)
                .await;
        });
    }
}

async fn bind_with_retry(
    port: u16,
    attempts: u32,
    delay: Duration,
) -> std::io::Result<TcpListener> {
    for attempt in 1..attempts {
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(server) => return Ok(server),
            Err(e) => {
                log::debug!("agent_ingress_bind_retry port={port} attempt={attempt} error={e}")
            }
        }
        tokio::time::sleep(delay).await;
    }
    TcpListener::bind(("127.0.0.1", port)).await
}

async fn claim_and_bind(
    claim: &AtomicBool,
    port: u16,
    attempts: u32,
    delay: Duration,
) -> Option<std::io::Result<TcpListener>> {
    if claim.swap(true, Ordering::SeqCst) {
        return None;
    }
    let result = bind_with_retry(port, attempts, delay).await;
    if result.is_err() {
        claim.store(false, Ordering::SeqCst);
    }
    Some(result)
}

async fn listener_or_notify(
    claim: &AtomicBool,
    port: u16,
    attempts: u32,
    delay: Duration,
    emit: impl FnOnce(&str, serde_json::Value),
) -> Option<TcpListener> {
    match claim_and_bind(claim, port, attempts, delay).await {
        None => {
            log::debug!("agent_ingress_start_skipped requested_port={port}");
            None
        }
        Some(Ok(listener)) => Some(listener),
        Some(Err(e)) => {
            log::warn!("agent_ingress_bind_failed port={port} error={e}");
            emit(INGRESS_DEAD_CHANNEL, serde_json::json!({ "port": port }));
            None
        }
    }
}

pub(super) fn start(app: &AppHandle, port: u16) {
    let app = app.clone();
    thread::Builder::new()
        .name("agent_ingress".into())
        .spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("failed to build agent_ingress runtime")
                .block_on(async move {
                    let Some(listener) = listener_or_notify(
                        &LISTENER_CLAIMED,
                        port,
                        BIND_ATTEMPTS,
                        BIND_RETRY_DELAY,
                        |channel, payload| {
                            if let Err(e) = app.emit_to(INGRESS_WINDOW, channel, payload) {
                                log::warn!("agent_ingress_dead_emit_failed error={e}");
                            }
                        },
                    )
                    .await
                    else {
                        return;
                    };
                    log::debug!("agent_ingress_listening port={port}");
                    let _ = serve(
                        listener,
                        Arc::new(Semaphore::new(CONNECTION_LIMIT)),
                        move |request| {
                            let app = app.clone();
                            async move { handle_request(&app, request).await }
                        },
                    )
                    .await;
                });
        })
        .expect("failed to spawn agent_ingress thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn bind_failure_emits_the_dead_channel_and_releases_the_claim() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        let claim = AtomicBool::new(false);
        let emitted = std::cell::RefCell::new(Vec::new());
        let listener = listener_or_notify(&claim, port, 1, Duration::ZERO, |channel, payload| {
            emitted.borrow_mut().push((channel.to_string(), payload));
        })
        .await;
        assert!(listener.is_none());
        assert_eq!(
            *emitted.borrow(),
            vec![("ingress-dead".into(), serde_json::json!({"port": port}))]
        );
        assert!(!claim.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn bind_with_retry_succeeds_once_the_port_is_released() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            drop(holder);
        });
        let server = bind_with_retry(port, 20, Duration::from_millis(50))
            .await
            .expect("bind must succeed after the holder releases the port");
        assert_eq!(server.local_addr().unwrap().port(), port);
    }

    #[tokio::test]
    async fn bind_with_retry_gives_up_while_the_port_stays_taken() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        assert!(bind_with_retry(port, 2, Duration::from_millis(10))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn claim_and_bind_skips_when_already_claimed() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        drop(holder);
        let claim = AtomicBool::new(true);
        assert!(claim_and_bind(&claim, port, 1, Duration::ZERO)
            .await
            .is_none());
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[tokio::test]
    async fn claim_and_bind_releases_the_claim_when_bind_fails() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        let claim = AtomicBool::new(false);
        let result = claim_and_bind(&claim, port, 2, Duration::from_millis(10)).await;
        assert!(matches!(result, Some(Err(_))));
        assert!(!claim.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn claim_and_bind_keeps_the_claim_after_a_bind() {
        let holder = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = holder.local_addr().unwrap().port();
        drop(holder);
        let claim = AtomicBool::new(false);
        assert!(matches!(
            claim_and_bind(&claim, port, 1, Duration::ZERO).await,
            Some(Ok(_))
        ));
        assert!(claim.load(Ordering::SeqCst));
        assert!(claim_and_bind(&claim, port, 1, Duration::ZERO)
            .await
            .is_none());
    }
}
