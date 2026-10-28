//! The Catalog: what `plugins/catalog.json` lists for this platform and where a plugin's release
//! asset is.

use super::manifest::{self, PluginJson};
use super::store::Source;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const CATALOG_URL: &str = "https://raw.githubusercontent.com/yw0nam/YUI/main/plugins/catalog.json";
/// Fails a request to an unreachable host early.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Bounds a whole request, a release zip included.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub source: Source,
    pub version: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
}

/// Where a plugin's release asset is and the sha256 it must have.
pub struct Release {
    pub id: String,
    pub source: Source,
    pub version: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Deserialize)]
struct Schema {
    schema: u32,
}

#[derive(Deserialize)]
struct Catalog {
    official: Vec<Official>,
    community: Vec<Community>,
}

#[derive(Deserialize)]
struct Official {
    id: String,
    version: String,
    summary: String,
    /// Keyed by platform.
    assets: HashMap<String, Asset>,
}

#[derive(Deserialize)]
struct Asset {
    url: String,
    sha256: String,
}

#[derive(Deserialize)]
struct Community {
    id: String,
    /// `<owner>/<name>` on GitHub.
    repo: String,
    platforms: Vec<String>,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("the HTTP client builds with its TLS backend")
}

/// This platform's plugins; a community plugin with an unreadable `plugin.json` carries its error.
pub async fn list(client: &reqwest::Client, config: &Config) -> Result<Vec<CatalogEntry>, String> {
    let Some(platform) = config.platform else {
        return Ok(Vec::new());
    };
    let catalog = fetch(client, config).await?;
    let community: Vec<_> = catalog
        .community
        .into_iter()
        .filter(|c| c.platforms.iter().any(|p| p == platform))
        .map(|c| {
            let (client, raw) = (client.clone(), config.raw.clone());
            tokio::spawn(async move {
                let (version, summary, error) = match plugin_json(&client, &raw, &c.repo).await {
                    Ok((version, summary)) => (Some(version), summary, None),
                    Err(e) => (None, None, Some(e)),
                };
                CatalogEntry {
                    id: c.id,
                    source: Source::Community,
                    version,
                    summary,
                    error,
                }
            })
        })
        .collect();
    let mut entries: Vec<CatalogEntry> = catalog
        .official
        .into_iter()
        .filter(|o| o.assets.contains_key(platform))
        .map(|o| CatalogEntry {
            id: o.id,
            source: Source::Official,
            version: Some(o.version),
            summary: Some(o.summary),
            error: None,
        })
        .collect();
    for task in community {
        entries.push(task.await.map_err(unavailable)?);
    }
    Ok(entries)
}

/// The release this platform installs for `id`.
pub async fn resolve(
    client: &reqwest::Client,
    config: &Config,
    id: &str,
) -> Result<Release, String> {
    if !manifest::valid_id(id) {
        return Err(format!("invalid plugin name: {id}"));
    }
    let catalog = fetch(client, config).await?;
    let no_build = || format!("no plugin build for this platform: {id}");
    if let Some(official) = catalog.official.into_iter().find(|o| o.id == id) {
        let asset = config
            .platform
            .and_then(|p| official.assets.get(p))
            .ok_or_else(no_build)?;
        check_version(&official.version)?;
        return Ok(Release {
            id: id.to_string(),
            source: Source::Official,
            version: official.version,
            url: asset.url.clone(),
            sha256: asset.sha256.clone(),
        });
    }
    let community = catalog
        .community
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("unknown catalog plugin: {id}"))?;
    let platform = config
        .platform
        .filter(|p| community.platforms.iter().any(|q| q == p))
        .ok_or_else(no_build)?;
    let (version, _) = plugin_json(client, &config.raw, &community.repo).await?;
    let asset = format!("{id}-{version}-{platform}.zip");
    let release = format!(
        "{}/{}/releases/download/v{version}",
        config.github, community.repo
    );
    let checksums = download(client, &format!("{release}/checksums.txt")).await?;
    // sha256sum lines: `<hex>  <name>`, or `<hex> *<name>` in binary mode.
    let sha256 = String::from_utf8_lossy(&checksums)
        .lines()
        .find_map(|line| {
            let (hex, name) = line.split_once(' ')?;
            (name.strip_prefix([' ', '*'])? == asset).then(|| hex.to_string())
        })
        .ok_or_else(|| format!("checksum missing: {asset}"))?;
    Ok(Release {
        id: id.to_string(),
        source: Source::Community,
        version,
        url: format!("{release}/{asset}"),
        sha256,
    })
}

pub async fn download(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    get(client, url)
        .await
        .map_err(|e| format!("plugin download failed: {e}"))
}

async fn fetch(client: &reqwest::Client, config: &Config) -> Result<Catalog, String> {
    let bytes = get(client, &config.catalog_url)
        .await
        .map_err(unavailable)?;
    let schema: Schema = serde_json::from_slice(&bytes).map_err(unavailable)?;
    if schema.schema != 1 {
        return Err(format!(
            "unsupported plugin catalog schema: {}",
            schema.schema
        ));
    }
    serde_json::from_slice(&bytes).map_err(unavailable)
}

fn unavailable(e: impl std::fmt::Display) -> String {
    format!("plugin catalog unavailable: {e}")
}

/// The version and description in the default branch's `.claude-plugin/plugin.json`.
async fn plugin_json(
    client: &reqwest::Client,
    raw: &str,
    repo: &str,
) -> Result<(String, Option<String>), String> {
    let valid_repo = repo.split_once('/').is_some_and(|(owner, name)| {
        [owner, name].iter().all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        })
    });
    if !valid_repo {
        return Err(format!("invalid plugin repo: {repo}"));
    }
    let url = format!("{raw}/{repo}/HEAD/.claude-plugin/plugin.json");
    let plugin: PluginJson = serde_json::from_slice(&download(client, &url).await?)
        .map_err(|e| format!("{url}: {e}"))?;
    let version = plugin
        .version
        .ok_or_else(|| "invalid plugin version: none".to_string())?;
    check_version(&version)?;
    Ok((version, plugin.description))
}

/// A version names a folder, so it is one path segment.
fn check_version(version: &str) -> Result<(), String> {
    let valid = !matches!(version, "" | "." | "..")
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".+-".contains(c));
    if valid {
        Ok(())
    } else {
        Err(format!("invalid plugin version: {version}"))
    }
}

async fn get(client: &reqwest::Client, url: &str) -> reqwest::Result<Vec<u8>> {
    let response = client.get(url).send().await?.error_for_status()?;
    Ok(response.bytes().await?.to_vec())
}
