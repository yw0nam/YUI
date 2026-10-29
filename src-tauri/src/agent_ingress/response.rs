/// Answers the HTTP request with the bridge outcome — the JSON body, or a bare status.
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
