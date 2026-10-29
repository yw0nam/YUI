//! The published snapshot, its types, and the name conflict rule.

use super::manifest::Manifest;
use super::server::Phase;
use super::store::{Source, StoredPlugin};
use rmcp::model::Tool;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Snapshot {
    pub revision: u64,
    pub plugins: Vec<PluginEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub source: Source,
    pub path: PathBuf,
    pub enabled: bool,
    pub consented: bool,
    pub error: Option<String>,
    pub servers: Vec<ServerEntry>,
    pub tools: Vec<ToolEntry>,
    pub skills: Vec<SkillEntry>,
    pub hidden: Vec<Hidden>,
    #[serde(skip)]
    pub enabled_seq: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Starting,
    Running,
    Failed,
    Exited,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ServerEntry {
    /// `<pluginId>/<serverName>`.
    pub id: String,
    pub name: String,
    /// The launch command and its arguments after placeholder expansion, joined by spaces.
    pub command: String,
    pub status: Status,
    pub phase: Option<Phase>,
    pub reason: Option<String>,
}

impl ServerEntry {
    /// Sets the status and clears the phase and reason.
    pub fn reset(&mut self, status: Status) {
        self.status = status;
        self.phase = None;
        self.reason = None;
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    pub name: String,
    pub server: String,
    pub description: Option<String>,
    pub input_schema: Value,
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SkillEntry {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Tool,
    Skill,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hidden {
    pub kind: Kind,
    pub name: String,
    pub holder: String,
}

/// One server as a plugin entry sees it; `tools` is empty unless the server runs.
pub struct ServerView<'a> {
    pub entry: &'a ServerEntry,
    pub tools: &'a [Tool],
}

/// A plugin's entry before the conflict rule; skills only while enabled and consented.
pub fn plugin_entry(
    plugin: &StoredPlugin,
    manifest: &Result<Manifest, String>,
    servers: &[ServerView],
) -> PluginEntry {
    let manifest_ok = manifest.as_ref().ok();
    let tools = servers
        .iter()
        .flat_map(|view| {
            view.tools.iter().map(|tool| ToolEntry {
                name: tool.name.to_string(),
                server: view.entry.id.clone(),
                description: tool.description.as_ref().map(|d| d.to_string()),
                input_schema: Value::Object((*tool.input_schema).clone()),
                meta: tool
                    .meta
                    .as_ref()
                    .and_then(|m| serde_json::to_value(m).ok()),
            })
        })
        .collect();
    let skills = manifest_ok
        .filter(|_| plugin.enabled && plugin.consented())
        .iter()
        .flat_map(|m| &m.skills)
        .map(|s| SkillEntry {
            name: s.name.clone(),
            description: s.description.clone(),
        })
        .collect();
    PluginEntry {
        id: plugin.id.clone(),
        version: manifest_ok.and_then(|m| m.version.clone()),
        description: manifest_ok.and_then(|m| m.description.clone()),
        source: plugin.source,
        path: plugin.path.clone(),
        enabled: plugin.enabled,
        consented: plugin.consented(),
        error: manifest.as_ref().err().cloned(),
        servers: servers.iter().map(|view| view.entry.clone()).collect(),
        tools,
        skills,
        hidden: Vec::new(),
        enabled_seq: plugin.enabled_seq,
    }
}

/// Hides each name another holder keeps: built-ins first, then plugins in `enabled_seq` order.
pub fn resolve(plugins: &mut [PluginEntry]) {
    let builtin: Vec<String> = serde_json::from_str(include_str!(
        "../../../src/contract/builtin-client-tools.json"
    ))
    .expect("builtin-client-tools.json is an array of names");
    let mut tool_holders: HashMap<String, String> = builtin
        .into_iter()
        .map(|name| (name, "builtin".to_string()))
        .collect();
    let mut skill_holders: HashMap<String, String> = HashMap::new();
    let mut order: Vec<&mut PluginEntry> = plugins.iter_mut().collect();
    order.sort_by_key(|p| p.enabled_seq);
    for PluginEntry {
        id,
        tools,
        skills,
        hidden,
        ..
    } in order
    {
        let mut claim =
            |holders: &mut HashMap<String, String>, kind: Kind, name: &str| match holders.get(name)
            {
                Some(holder) => {
                    hidden.push(Hidden {
                        kind,
                        name: name.to_string(),
                        holder: holder.clone(),
                    });
                    false
                }
                None => {
                    holders.insert(name.to_string(), id.clone());
                    true
                }
            };
        tools.retain(|t| claim(&mut tool_holders, Kind::Tool, &t.name));
        skills.retain(|s| claim(&mut skill_holders, Kind::Skill, &s.name));
    }
}
