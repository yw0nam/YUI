use super::*;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Arc;

struct Server {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
}

impl Server {
    fn start() -> Self {
        let server = bind_with_retry(0, 1, Duration::ZERO).unwrap();
        let addr = server.server_addr().to_ip().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        thread::spawn(move || {
            while !stopped.load(Ordering::SeqCst) {
                if let Some(mut request) = server.recv_timeout(Duration::from_millis(10)).unwrap() {
                    let result = route_request(&mut request, |_| Ok(true), |_| true);
                    let code = result.map_or_else(|code| code, |_| 200);
                    let _ = request.respond(tiny_http::Response::empty(code));
                }
            }
        });
        Self { addr, stop }
    }

    fn connect(&self) -> TcpStream {
        let stream = TcpStream::connect(self.addr).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(100)))
            .unwrap();
        stream
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[test]
fn stalled_bodies_leave_other_routes_responsive() {
    for body in [
        "Content-Length: 2000\r\n\r\n0123456789",
        "Transfer-Encoding: chunked\r\n\r\na\r\n0123456789\r\n",
        "Content-Length: 2000\r\nExpect: 100-continue\r\n\r\n0123456789",
    ] {
        let server = Server::start();
        let mut stalled = server.connect();
        write!(
            stalled,
            "POST /signals HTTP/1.1\r\nHost: localhost\r\n{body}"
        )
        .unwrap();
        thread::sleep(Duration::from_millis(20));
        let mut query = server.connect();
        query
            .write_all(b"GET /avatar/state HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut response = [0; 512];
        let read = query.read(&mut response);
        assert!(
            read.is_ok(),
            "concurrent avatar request must answer within 100 ms: {read:?}; {body}"
        );
        assert!(String::from_utf8_lossy(&response[..read.unwrap()]).starts_with("HTTP/1.1 200"));
        drop(stalled);
    }
}

#[test]
fn connections_beyond_the_cap_are_closed() {
    let server = Server::start();
    let held: Vec<_> = (0..64).map(|_| server.connect()).collect();
    let mut extra = server.connect();
    let mut byte = [0];
    let read = extra.read(&mut byte);
    assert!(
        matches!(read, Ok(0)),
        "connection 65 must close before parsing: {read:?}"
    );
    drop(held);
    let mut query = server.connect();
    query
        .write_all(b"GET /avatar/state HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .unwrap();
    let mut response = [0; 512];
    let read = query.read(&mut response).unwrap();
    assert!(String::from_utf8_lossy(&response[..read]).starts_with("HTTP/1.1 200"));
}
