//! Which herdr servers to watch: local and every enabled saved machine.

use std::path::PathBuf;

pub struct Watched {
    pub machine: String,
    pub label: String,
    pub endpoint: Endpoint,
}

pub enum Endpoint {
    Local(PathBuf),
    Remote { target: String, session: String },
}

pub fn local_socket() -> PathBuf {
    PathBuf::new()
}

pub fn remote_socket(_home: &str, _session: &str) -> String {
    String::new()
}

pub async fn watched(_locate: fn() -> Option<PathBuf>) -> Vec<Watched> {
    Vec::new()
}