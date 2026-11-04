use super::*;
use crate::agent_ingress::{
    response::{self, status},
    route::RouteKind,
    server, threads,
};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Semaphore};

pub(in crate::agent_ingress) struct Server {
    addr: SocketAddr,
    stop: Option<oneshot::Sender<()>>,
    worker: Option<thread::JoinHandle<()>>,
    connections: Arc<Semaphore>,
    pub(in crate::agent_ingress) store: Arc<crate::threads::store::ThreadStore>,
}

impl Server {
    pub(in crate::agent_ingress) fn start() -> Self {
        Self::with_accept_errors(Vec::new())
    }

    fn with_accept_errors(errors: Vec<std::io::ErrorKind>) -> Self {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let (stop, stopped) = oneshot::channel();
        let connections = Arc::new(Semaphore::new(server::CONNECTION_LIMIT));
        let capacity = connections.clone();
        let store = Arc::new(crate::threads::store::ThreadStore::new(
            vec![],
            Box::new(|_| Ok(())),
            |_| {},
        ));
        let threads = store.clone();
        let worker = thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async move {
                    let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                    let mut errors = errors.into_iter();
                    let listener = &listener;
                    let accept = move || {
                        let error = errors.next();
                        async move {
                            match error {
                                Some(kind) => Err(std::io::Error::from(kind)),
                                None => listener.accept().await,
                            }
                        }
                    };
                    let serving = server::serve(accept, capacity, move |request| {
                        let threads = threads.clone();
                        async move {
                            let refused_host = request
                                .headers()
                                .get("Host")
                                .is_some_and(|host| host == "evil.example");
                            let expected_label = if request.uri().path().starts_with("/presets/x/")
                            {
                                "pet-x"
                            } else {
                                "main"
                            };
                            match server::route_request(
                                request,
                                |_| panic!("must not read registry"),
                                |label| {
                                    assert!(
                                        !refused_host,
                                        "must not check windows for a refused host"
                                    );
                                    assert_eq!(label, expected_label);
                                    true
                                },
                            )
                            .await
                            {
                                Ok(Dispatch {
                                    kind: RouteKind::Thread(route),
                                    ..
                                }) => threads::requests::handle(threads, route).await,
                                Ok(Dispatch {
                                    kind: RouteKind::Avatar(_),
                                    ..
                                }) => {
                                    response::respond_json(Ok(serde_json::json!({"state":"ready"})))
                                }
                                Ok(_) => status(200),
                                Err(code) => status(code),
                            }
                        }
                    });
                    tokio::select! { _ = serving => {}, _ = stopped => {} }
                });
        });
        Self {
            addr,
            stop: Some(stop),
            worker: Some(worker),
            connections,
            store,
        }
    }

    pub(in crate::agent_ingress) fn connect(&self) -> TcpStream {
        let stream = TcpStream::connect(self.addr).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
    }

    pub(in crate::agent_ingress) fn wait_capacity(&self, available: usize) {
        let start = Instant::now();
        while self.connections.available_permits() != available
            && start.elapsed() < Duration::from_secs(5)
        {
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(self.connections.available_permits(), available);
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.stop.take().unwrap().send(());
        let joined = self.worker.take().unwrap().join();
        if !thread::panicking() {
            joined.unwrap();
        }
    }
}

fn response(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).unwrap();
    String::from_utf8(bytes).unwrap()
}

fn query(server: &Server) -> String {
    let mut stream = server.connect();
    stream
        .write_all(b"GET /avatar/state HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .unwrap();
    response(&mut stream)
}

#[test]
fn stalled_bodies_leave_other_routes_responsive() {
    let server = Server::start();
    let mut stalled = Vec::new();
    for body in [
        "Content-Length: 2000\r\n\r\n0123456789",
        "Transfer-Encoding: chunked\r\n\r\na\r\n0123456789\r\n",
        "Content-Length: 2000\r\nExpect: 100-continue\r\n\r\n0123456789",
    ] {
        let mut stream = server.connect();
        if body.contains("Expect:") {
            let (headers, data) = body.split_once("\r\n\r\n").unwrap();
            write!(
                stream,
                "POST /signals HTTP/1.1\r\nHost: localhost\r\n{headers}\r\n\r\n"
            )
            .unwrap();
            let mut interim = [0; 25];
            stream.read_exact(&mut interim).unwrap();
            assert_eq!(&interim, b"HTTP/1.1 100 Continue\r\n\r\n");
            stream.write_all(data.as_bytes()).unwrap();
        } else {
            write!(
                stream,
                "POST /signals HTTP/1.1\r\nHost: localhost\r\n{body}"
            )
            .unwrap();
        }
        server.wait_capacity(63 - stalled.len());
        let start = Instant::now();
        let result = query(&server);
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "concurrent avatar request must answer within 2 s: {body}"
        );
        assert!(result.starts_with("HTTP/1.1 200"), "{result}");
        assert!(result.contains("application/json"));
        assert!(result.ends_with(r#"{"state":"ready"}"#));
        stalled.push(stream);
    }
    for mut stream in stalled {
        stream
            .set_read_timeout(Some(Duration::from_secs(15)))
            .unwrap();
        let result = response(&mut stream);
        assert!(result.contains("HTTP/1.1 400"), "{result}");
    }
}

#[test]
fn connections_beyond_the_cap_are_closed() {
    let server = Server::start();
    let held: Vec<_> = (0..64).map(|_| server.connect()).collect();
    server.wait_capacity(0);
    for _ in 0..16 {
        let mut extra = server.connect();
        let mut byte = [0];
        let start = Instant::now();
        let read = extra.read(&mut byte);
        assert!(
            matches!(read, Ok(0)),
            "connection 65 must close before parsing: {read:?}"
        );
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "the cap closes connections before the header timeout"
        );
    }
    assert_eq!(server.connections.available_permits(), 0);
    drop(held);
    server.wait_capacity(64);
    assert!(query(&server).starts_with("HTTP/1.1 200"));
}

#[test]
fn incomplete_headers_time_out_and_release_capacity() {
    let server = Server::start();
    let mut stream = server.connect();
    let start = Instant::now();
    stream
        .write_all(b"GET /avatar/state HTTP/1.1\r\nHost:")
        .unwrap();
    server.wait_capacity(63);
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    assert_eq!(response(&mut stream), "");
    assert!(start.elapsed() >= Duration::from_millis(4800));
    assert!(start.elapsed() < Duration::from_secs(10));
    server.wait_capacity(64);
    assert!(query(&server).starts_with("HTTP/1.1 200"));
}

#[test]
fn trickled_body_uses_an_absolute_deadline() {
    let server = Server::start();
    let mut stream = server.connect();
    stream
        .write_all(b"POST /signals HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2000\r\n\r\nx")
        .unwrap();
    let mut writer = stream.try_clone().unwrap();
    let writing = thread::spawn(move || {
        for _ in 0..11 {
            thread::sleep(Duration::from_secs(1));
            if writer.write_all(b"x").is_err() {
                break;
            }
        }
    });
    stream
        .set_read_timeout(Some(Duration::from_secs(15)))
        .unwrap();
    let start = Instant::now();
    let result = response(&mut stream);
    assert!(result.starts_with("HTTP/1.1 400"), "{result}");
    assert!(start.elapsed() >= Duration::from_millis(9800));
    assert!(start.elapsed() < Duration::from_secs(15));
    writing.join().unwrap();
}

#[test]
fn guards_precede_continue_and_body_reads() {
    let server = Server::start();
    for (headers, code) in [
        ("Host: evil.example\r\nOrigin: http://evil.example", 421),
        ("Host: localhost\r\nOrigin: http://evil.example", 403),
    ] {
        let mut stream = server.connect();
        write!(stream, "POST /presets/x/signals HTTP/1.1\r\n{headers}\r\nExpect: 100-continue\r\nContent-Length: 2000\r\n\r\n").unwrap();
        let result = response(&mut stream);
        assert!(result.starts_with(&format!("HTTP/1.1 {code}")), "{result}");
        assert!(!result.contains("100 Continue"), "{result}");
    }
}

#[test]
fn ceiling_and_one_request_per_connection_hold() {
    let server = Server::start();
    for body in [vec![b'x'; 65537], vec![0xff]] {
        let mut stream = server.connect();
        write!(
            stream,
            "POST /signals HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .unwrap();
        stream.write_all(&body).unwrap();
        assert!(response(&mut stream).starts_with("HTTP/1.1 400"));
    }
    let mut stream = server.connect();
    stream.write_all(b"GET /avatar/state HTTP/1.1\r\nHost: localhost\r\n\r\nGET /avatar/state HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
    let result = response(&mut stream);
    assert_eq!(result.matches("HTTP/1.1 200").count(), 1);
}

#[test]
fn loopback_request_reaches_window_check_without_reading_registry() {
    let server = Server::start();
    let mut stream = server.connect();
    let body = r#"{"signals":[],"envelope":{}}"#;
    write!(
        stream,
        "POST /presets/x/signals HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    assert!(response(&mut stream).starts_with("HTTP/1.1 200"));
}

#[test]
fn accept_errors_do_not_stop_the_listener() {
    let server = Server::with_accept_errors(vec![
        std::io::ErrorKind::ConnectionAborted,
        std::io::ErrorKind::ConnectionReset,
        std::io::ErrorKind::ConnectionRefused,
        std::io::ErrorKind::Other,
    ]);
    let mut stream = server.connect();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    stream
        .write_all(b"GET /avatar/state HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .unwrap();
    assert!(response(&mut stream).starts_with("HTTP/1.1 200"));
}

#[tokio::test]
async fn bind_failure_emits_the_dead_channel() {
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
