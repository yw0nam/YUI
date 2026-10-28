//! The Catalog: what `plugins/catalog.json` lists for this platform and where a plugin's release
//! asset is.

use super::store::Source;
use serde::Serialize;

const CATALOG_URL: &str = "https://raw.githubusercontent.com/yw0nam/YUI/main/plugins/catalog.json";

pub struct Config {
    pub catalog_url: String,
    pub github: String,
    pub raw: String,
    /// The release asset key, `None` where no plugin build exists.
    pub platform: Option<&'static str>,
}

impl Config {
    pub fn production() -> Self {
        // A verify build can point at another catalog.
        #[cfg(feature = "verify")]
        let catalog_url =
            std::env::var("YUI_PLUGIN_CATALOG_URL").unwrap_or_else(|_| CATALOG_URL.to_string());
        #[cfg(not(feature = "verify"))]
        let catalog_url = CATALOG_URL.to_string();
        let platform = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            Some("darwin-arm64")
        } else if cfg!(all(windows, target_arch = "x86_64")) {
            Some("windows-x64")
        } else {
            None
        };
        Self {
            catalog_url,
            github: "https://github.com".to_string(),
            raw: "https://raw.githubusercontent.com".to_string(),
            platform,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub source: Source,
    pub version: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
}
