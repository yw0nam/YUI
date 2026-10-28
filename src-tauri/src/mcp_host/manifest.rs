//! Reads a plugin folder: `.claude-plugin/plugin.json` and `.mcp.json`.

use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug)]
pub struct Manifest {
    pub id: String,
    pub version: Option<String>,
    pub description: Option<String>,
    /// In `.mcp.json` key order.
    pub servers: Vec<ServerSpec>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSpec {
    #[serde(skip)]
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Deserialize)]
struct PluginJson {
    name: String,
    version: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct McpJson {
    #[serde(rename = "mcpServers")]
    mcp_servers: IndexMap<String, ServerSpec>,
}

pub fn read(folder: &Path) -> Result<Manifest, String> {
    let plugin: PluginJson = read_json(&folder.join(".claude-plugin/plugin.json"))?;
    let valid_id = plugin
        .name
        .starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && plugin
            .name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid_id {
        return Err(format!("invalid plugin name: {}", plugin.name));
    }
    let mcp_path = folder.join(".mcp.json");
    let servers = if mcp_path.exists() {
        read_json::<McpJson>(&mcp_path)?
            .mcp_servers
            .into_iter()
            .map(|(name, spec)| ServerSpec { name, ..spec })
            .collect()
    } else {
        Vec::new()
    };
    Ok(Manifest {
        id: plugin.name,
        version: plugin.version,
        description: plugin.description,
        servers,
    })
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}
