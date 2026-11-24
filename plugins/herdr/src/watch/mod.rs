//! Watches herdr servers and signals agent state changes (unix only).

pub mod forward;
pub mod machines;
pub mod signal;
pub mod subscribe;

use std::path::PathBuf;
use std::sync::Arc;

pub const SIGNALS_METHOD: &str = "notifications/io.github.yw0nam.yui/signals";

/// Delivers one signal group's params to the MCP peer.
pub type Notify = Arc<dyn Fn(serde_json::Value) + Send + Sync>;

pub fn socket_dir() -> PathBuf {
    std::env::temp_dir().join(format!("yui-herdr-{}", std::process::id()))
}

pub fn spawn(_locate: fn() -> Option<PathBuf>, _notify: Notify) {}

pub fn cleanup() {}

/// One stderr line per event, so an error's newlines never split it.
pub(crate) fn one_line(text: &str) -> String {
    text.replace(['\n', '\r'], " ")
}