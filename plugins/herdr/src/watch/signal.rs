//! Builds one signal group's params for a pane state change.

use serde_json::Value;

#[derive(Clone)]
pub struct Pane {
    pub pane: String,
    pub agent: String,
    pub status: String,
    pub title: String,
    pub cwd: String,
}

pub fn event_type(_status: &str) -> Option<&'static str> {
    None
}

pub fn params(
    _machine: &str,
    _machine_label: &str,
    _pane: &Pane,
    _event: &str,
    _occurred_at: u64,
) -> Value {
    serde_json::json!({})
}