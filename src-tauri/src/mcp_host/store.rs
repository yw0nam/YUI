//! The host's stored state: `<app_data>/plugins/state.json`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub plugins: Vec<StoredPlugin>,
    pub next_seq: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPlugin {
    pub id: String,
    pub source: Source,
    pub path: PathBuf,
    pub enabled: bool,
    /// The path the user consented to; consent holds while it equals `path`.
    pub approved_path: Option<PathBuf>,
    /// Orders enabled plugins for the name conflict rule.
    pub enabled_seq: Option<u64>,
}

impl State {
    pub fn plugin(&self, id: &str) -> Option<&StoredPlugin> {
        self.plugins.iter().find(|p| p.id == id)
    }

    pub fn plugin_mut(&mut self, id: &str) -> Option<&mut StoredPlugin> {
        self.plugins.iter_mut().find(|p| p.id == id)
    }
}

impl StoredPlugin {
    pub fn consented(&self) -> bool {
        self.approved_path.as_ref() == Some(&self.path)
    }
}

/// `Err` holds why the file cannot be used; the host then refuses every state write.
pub fn load(path: &Path) -> Result<State, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(State::default()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    serde_json::from_str(&text).or_else(|parse| {
        let bad = path.with_extension("json.bad");
        std::fs::rename(path, &bad)
            .map_err(|e| format!("{}: {parse}; moving it aside failed: {e}", path.display()))?;
        log::warn!(
            "mcp_host_state_invalid moved_to={} error={parse}",
            bad.display()
        );
        Ok(State::default())
    })
}

/// Writes `state.json.tmp` beside the file, then renames it over the file.
pub fn save(path: &Path, state: &State) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(state)?)?;
    std::fs::rename(&tmp, path)
}
