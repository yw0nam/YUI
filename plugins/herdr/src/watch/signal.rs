//! Builds one signal group's params for a pane state change.

use serde_json::{json, Value};

#[derive(Clone)]
pub struct Pane {
    pub pane: String,
    pub agent: String,
    pub status: String,
    pub title: String,
    pub cwd: String,
}

/// The event type for a state worth a signal, else None.
pub fn event_type(status: &str) -> Option<&'static str> {
    match status {
        "done" => Some("agent_done"),
        "blocked" => Some("agent_blocked"),
        _ => None,
    }
}

pub fn params(
    machine: &str,
    machine_label: &str,
    pane: &Pane,
    event: &str,
    occurred_at: u64,
) -> Value {
    let label = [machine_label, pane.agent.as_str(), pane.title.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    json!({
        "signals": [{
            "machine": machine,
            "machine_label": machine_label,
            "pane": pane.pane,
            "agent": pane.agent,
            "status": pane.status,
            "title": pane.title,
            "cwd": pane.cwd
        }],
        "envelope": {
            "source": "herdr",
            "event_type": event,
            "delivery": "urgent",
            "event_id": format!("{machine}:{}:{occurred_at}", pane.pane),
            "occurred_at": occurred_at,
            "label": label
        }
    })
}
