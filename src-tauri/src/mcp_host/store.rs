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

/// `Err` holds why the file cannot be used; the host then refuses every state write.
pub fn load(path: &Path) -> Result<State, String> {
    let _ = path;
    Ok(State::default())
}

pub fn save(path: &Path, state: &State) -> std::io::Result<()> {
    let _ = (path, state);
    Ok(())
}
