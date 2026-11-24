//! Parses herdr agent and machine listings into rows.

use serde_json::Value;

/// One agent in a herdr pane, from an `agent list` response.
#[derive(Clone)]
pub struct AgentRow {
    pub id: String,
    pub agent: String,
    pub status: String,
    pub title: String,
    pub cwd: String,
}

/// The agents of an `agent list` response; None when `result.agents` is missing.
pub fn agent_rows(response: &Value) -> Option<Vec<AgentRow>> {
    let list = response
        .pointer("/result/agents")
        .and_then(Value::as_array)?;
    Some(
        list.iter()
            .filter_map(|a| {
                let id = a.get("pane_id").and_then(Value::as_str)?.to_string();
                let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                Some(AgentRow {
                    id,
                    agent: s("agent"),
                    status: s("agent_status"),
                    title: s("terminal_title_stripped"),
                    cwd: s("cwd"),
                })
            })
            .collect(),
    )
}

/// One saved machine of `machine list --json`.
#[derive(Clone)]
pub struct MachineRow {
    pub id: String,
    pub label: String,
    pub target: String,
    pub session: String,
    pub enabled: bool,
}

/// The saved machines; entries without an id are skipped, an empty session reads `default`.
pub fn machine_rows(text: &str) -> Result<Vec<MachineRow>, String> {
    let invalid = || "could not parse machine list".to_string();
    let value = serde_json::from_str::<Value>(text).map_err(|_| invalid())?;
    let list = value.as_array().ok_or_else(invalid)?;
    Ok(list
        .iter()
        .filter_map(|m| {
            let id = m
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())?
                .to_string();
            let s = |k: &str| m.get(k).and_then(Value::as_str).unwrap_or("");
            let session = s("session");
            Some(MachineRow {
                id,
                label: s("label").to_string(),
                target: s("target").to_string(),
                session: if session.is_empty() {
                    "default".to_string()
                } else {
                    session.to_string()
                },
                enabled: m.get("enabled").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect())
}
