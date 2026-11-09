//! The `.yui` preset file's `manifest.json`.

use crate::voice_import::AUDIO_EXTS;
use serde::{Deserialize, Serialize};

pub(crate) const UNREADABLE: &str = "preset file unreadable";

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
    /// `name` is the VRM's own name, which the receiver's copy is stored and listed under.
    File {
        file: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    Bundled {
        bundled: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ManifestVoice {
    pub file: String,
    pub label: String,
}

impl Manifest {
    /// Refuses a manifest this client does not read, with `preset file unreadable`.
    pub(crate) fn validate(&self) -> Result<(), String> {
        let vrm_ok = match &self.vrm {
            None => true,
            Some(ManifestVrm::File { file, .. }) => file == VRM_ENTRY,
            Some(ManifestVrm::Bundled { bundled }) => !bundled.is_empty(),
        };
        let voice_ok = self
            .voice
            .as_ref()
            .is_none_or(|v| voice_ext(&v.file).is_some());
        if self.format == FORMAT && self.version == VERSION && vrm_ok && voice_ok {
            Ok(())
        } else {
            Err(UNREADABLE.to_string())
        }
    }
}

/// The audio extension of a manifest voice entry `voice/clip.<ext>`, when it is an allowed one.
pub(crate) fn voice_ext(file: &str) -> Option<&str> {
    file.strip_prefix("voice/clip.")
        .filter(|ext| AUDIO_EXTS.contains(ext))
}
