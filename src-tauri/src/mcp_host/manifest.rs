//! Reads a plugin folder: `.claude-plugin/plugin.json`, `.mcp.json`, and `skills/*/SKILL.md`.

use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct Manifest {
    pub id: String,
    pub version: Option<String>,
    pub description: Option<String>,
    /// In `.mcp.json` key order.
    pub servers: Vec<ServerSpec>,
    pub skills: Vec<Skill>,
}

#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: PathBuf,
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
        skills: read_skills(folder),
    })
}

/// The `SKILL.md` text after its frontmatter, without leading blank lines.
pub fn skill_body(path: &Path) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(split_frontmatter(&text).1)
}

/// Skills in folder-name order; one without a `description` is skipped.
fn read_skills(folder: &Path) -> Vec<Skill> {
    let Ok(entries) = std::fs::read_dir(folder.join("skills")) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path().join("SKILL.md"))
        .filter(|p| p.is_file())
        .collect();
    paths.sort();
    paths
        .into_iter()
        .filter_map(|path| {
            let text = std::fs::read_to_string(&path).ok()?;
            let (front, _) = split_frontmatter(&text);
            let field = |key: &str| {
                front.iter().find_map(|line| {
                    let value = unquote(line.strip_prefix(key)?.strip_prefix(':')?);
                    (!value.is_empty()).then_some(value)
                })
            };
            let Some(description) = field("description") else {
                log::warn!(
                    "mcp_host_skill_skipped path={} reason=no_description",
                    path.display()
                );
                return None;
            };
            let folder_name = path.parent()?.file_name()?.to_string_lossy().into_owned();
            Some(Skill {
                name: field("name").unwrap_or(folder_name),
                description,
                path,
            })
        })
        .collect()
}

/// The lines between the first two `---` lines, and the text after them without leading blank lines.
fn split_frontmatter(text: &str) -> (Vec<&str>, String) {
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return (Vec::new(), text.to_string());
    }
    let front = lines
        .by_ref()
        .take_while(|l| l.trim_end() != "---")
        .collect();
    let body = lines
        .skip_while(|l| l.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (front, body)
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.starts_with('"') {
        return serde_json::from_str(value).unwrap_or_else(|_| value.to_string());
    }
    match value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')) {
        Some(inner) => inner.replace("''", "'"),
        None => value.to_string(),
    }
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}
