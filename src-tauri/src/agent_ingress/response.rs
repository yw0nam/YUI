//! HTTP responses for the ingress.

use http_body_util::Full;
use hyper::body::Bytes;
use hyper::Response;

pub(super) type HttpResponse = Response<Full<Bytes>>;

pub(super) fn status(code: u16) -> HttpResponse {
    Response::builder()
        .status(code)
        .body(Full::new(Bytes::new()))
        .expect("valid ingress status")
}

pub(super) fn respond_json(outcome: Result<serde_json::Value, u16>) -> HttpResponse {
    match outcome {
        Ok(value) => Response::builder()
            .status(200)
            .header(hyper::header::CONTENT_TYPE, "application/json")
            .body(Full::new(Bytes::from(value.to_string())))
            .expect("valid JSON response"),
        Err(code) => status(code),
    }
}
