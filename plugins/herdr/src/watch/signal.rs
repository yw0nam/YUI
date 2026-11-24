//! Builds one signal group's params for a pane state change.

use crate::parse::AgentRow;
use serde_json::{json, Value};

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
    row: &AgentRow,
    event: &str,
    occurred_at: u64,
) -> Value {
    let label = [machine_label, row.agent.as_str(), row.title.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    json!({
        "signals": [{
            "machine": machine,
            "machine_label": machine_label,
            "pane": row.id,
            "agent": row.agent,
            "status": row.status,
            "title": row.title,
            "cwd": row.cwd
        }],
        "envelope": {
            "source": "herdr",
            "event_type": event,
            "delivery": "urgent",
            "event_id": format!("{machine}:{}:{occurred_at}", row.id),
            "occurred_at": occurred_at,
            "label": label
        }
    })
}
