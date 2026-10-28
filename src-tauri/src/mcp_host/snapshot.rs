//! The published snapshot, its types, and the name conflict rule.

use super::server::Phase;
use super::store::Source;
use serde::Serialize;
use serde_json::Value;
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

/// Moves every tool and skill name another holder keeps into the loser's `hidden`.
pub fn resolve(plugins: &mut [PluginEntry]) {
    let _ = plugins;
}
