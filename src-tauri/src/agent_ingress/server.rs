//! Bounded HTTP/1 transport on the ingress thread.

use super::guard;
use super::payload::{rejected_level, BODY_CEILING_BYTES, INGRESS_DEAD_CHANNEL};
use super::response::HttpResponse;
use super::route::{dispatch, Dispatch};
use http_body_util::{BodyExt, Limited};
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
use tokio::{net::TcpListener, sync::Semaphore};

const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(5);
const BODY_DEADLINE: Duration = Duration::from_secs(10);
pub(super) const CONNECTION_LIMIT: usize = 64;
const BIND_ATTEMPTS: u32 = 8;
const BIND_RETRY_DELAY: Duration = Duration::from_millis(500);
static LISTENER_CLAIMED: AtomicBool = AtomicBool::new(false);

async fn read_body(body: Incoming) -> Option<String> {
    let collected = tokio::time::timeout(
        BODY_DEADLINE,
        Limited::new(body, BODY_CEILING_BYTES).collect(),
    )
    .await
    .ok()?
    .ok()?;
    String::from_utf8(collected.to_bytes().to_vec()).ok()
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

pub(super) async fn serve<A, Accept, F, Fut>(mut accept: A, connections: Arc<Semaphore>, handler: F)
where
    A: FnMut() -> Accept,
    Accept: Future<Output = std::io::Result<(tokio::net::TcpStream, std::net::SocketAddr)>>,
    F: Fn(Request<Incoming>) -> Fut + Clone + Send + 'static,
    Fut: Future<Output = HttpResponse> + Send,
{
    loop {
        let (stream, _) = match accept().await {
            Ok(connection) => connection,
            Err(e) => {
                if !matches!(
                    e.kind(),
                    std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionRefused
                ) {
                    log::error!("agent_ingress_accept_failed error={e}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                continue;
            }
        };
        let Ok(permit) = connections.clone().try_acquire_owned() else {
            log::debug!("agent_ingress_connection_refused");
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

pub(super) fn start<F, Fut>(
    port: u16,
    handler: F,
    on_dead: impl FnOnce(&str, serde_json::Value) + Send + 'static,
) where
    F: Fn(Request<Incoming>) -> Fut + Clone + Send + 'static,
    Fut: Future<Output = HttpResponse> + Send,
{
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
                        on_dead,
                    )
                    .await
                    else {
                        return;
                    };
                    log::debug!("agent_ingress_listening port={port}");
                    serve(
                        || listener.accept(),
                        Arc::new(Semaphore::new(CONNECTION_LIMIT)),
                        handler,
                    )
                    .await;
                });
        })
        .expect("failed to spawn agent_ingress thread");
}

#[cfg(test)]
#[path = "server_tests.rs"]
pub(in crate::agent_ingress) mod tests;
