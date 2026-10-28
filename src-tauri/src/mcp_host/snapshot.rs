//! The published snapshot, its types, and the name conflict rule.

use super::server::Phase;
use super::store::Source;
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
    pub status: Status,
    pub phase: Option<Phase>,
    pub reason: Option<String>,
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

/// Moves every tool and skill name another holder keeps into the loser's `hidden`: built-in
/// client tools first, then plugins in `enabled_seq` order, each in its own declared order.
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
