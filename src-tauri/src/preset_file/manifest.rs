//! The `.yui` preset file's `manifest.json`.

use serde::{Deserialize, Serialize};

pub(crate) const FORMAT: &str = "yui-preset";
pub(crate) const VERSION: u32 = 1;
pub(crate) const VRM_ENTRY: &str = "vrm/model.vrm";

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Manifest {
    pub format: String,
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vrm: Option<ManifestVrm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<ManifestVoice>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum ManifestVrm {
    File { file: String },
    Bundled { bundled: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ManifestVoice {
    pub file: String,
    pub label: String,
}

impl Manifest {
    /// Refuses a manifest this client does not read, with `bundle unreadable`.
    pub(crate) fn validate(&self) -> Result<(), String> {
        Ok(())
    }
}

/// The audio extension of a manifest voice entry `voice/clip.<ext>`, when it is an allowed one.
pub(crate) fn voice_ext(_file: &str) -> Option<&str> {
    None
}
