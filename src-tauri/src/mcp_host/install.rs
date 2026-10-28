//! Installs, updates, and removes plugins: download, sha256 check, unpack, staged switch.

use super::catalog::{self, CatalogEntry, Release};
use super::host::{unknown, writable, Host, Live};
use super::manifest;
use super::store::{Source, StoredPlugin};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;

impl Host {
    pub async fn catalog(&self) -> Result<Vec<CatalogEntry>, String> {
        catalog::list(&self.http, &self.catalog).await
    }

    /// Installs the catalog version of the plugin, or switches an installed catalog plugin to it.
    pub async fn install(self: &Arc<Self>, plugin_id: &str) -> Result<(), String> {
        let _installs = self.installs.lock().await;
        if writable(&self.lock().state)?
            .plugin(plugin_id)
            .is_some_and(|p| p.source == Source::Local)
        {
            return Err(listed(plugin_id));
        }
        let release = catalog::resolve(&self.http, &self.catalog, plugin_id).await?;
        let current = self
            .lock()
            .live
            .get(plugin_id)
            .and_then(|live| live.manifest.as_ref().ok())
            .is_some_and(|m| m.version.as_ref() == Some(&release.version));
        if current {
            return Ok(());
        }
        let bytes = catalog::download(&self.http, &release.url).await?;
        if !format!("{:x}", Sha256::digest(&bytes)).eq_ignore_ascii_case(&release.sha256) {
            let asset = release.url.rsplit('/').next().unwrap_or(&release.url);
            return Err(format!("checksum mismatch: {asset}"));
        }
        let path = unpack(
            &self.dir.join("installed").join(plugin_id),
            &release,
            &bytes,
        )?;

        let (stopping, tickets, old) = {
            let mut inner = self.lock();
            let mut state = writable(&inner.state)?.clone();
            let Some(plugin) = state.plugin_mut(plugin_id) else {
                let plugin = StoredPlugin {
                    id: plugin_id.to_string(),
                    source: release.source,
                    path,
                    enabled: false,
                    approved_path: None,
                    enabled_seq: None,
                };
                let live = Live::read(&plugin, &self.log_dir, self.offset);
                state.plugins.push(plugin);
                self.save(&mut inner, state)?;
                inner.live.insert(plugin_id.to_string(), live);
                self.publish(&mut inner);
                return Ok(());
            };
            // An `add` ran while this one downloaded.
            if plugin.source == Source::Local {
                let _ = remove_dir(&path);
                return Err(listed(plugin_id));
            }
            let keeps_consent = release.source == Source::Official && plugin.consented();
            plugin.approved_path = keeps_consent.then(|| path.clone());
            plugin.source = release.source;
            let old = std::mem::replace(&mut plugin.path, path.clone());
            let run = plugin.enabled && plugin.consented();
            let live = Live::read(plugin, &self.log_dir, self.offset);
            self.save(&mut inner, state)?;
            let stopping = inner.stop_servers(|id, _| id == plugin_id);
            inner.live.insert(plugin_id.to_string(), live);
            inner.updating.insert(plugin_id.to_string());
            let tickets = if run {
                inner.tickets(plugin_id, |_| true)
            } else {
                Vec::new()
            };
            self.publish(&mut inner);
            (stopping, tickets, old)
        };
        self.stop(stopping).await;
        self.lock().updating.remove(plugin_id);
        if old != path {
            if let Err(e) = remove_dir(&old) {
                log::warn!(
                    "mcp_host_old_version_not_removed path={} error={e}",
                    old.display()
                );
            }
        }
        self.start(tickets).await;
        Ok(())
    }

    /// Stops the plugin's servers, unlists it, and deletes its data; a catalog plugin also loses
    /// its installed versions.
    pub async fn remove(&self, plugin_id: &str) -> Result<(), String> {
        let _installs = self.installs.lock().await;
        let (stopping, source) = {
            let mut inner = self.lock();
            let mut state = writable(&inner.state)?.clone();
            let index = state
                .plugins
                .iter()
                .position(|p| p.id == plugin_id)
                .ok_or_else(|| unknown(plugin_id))?;
            let removed = state.plugins.remove(index);
            self.save(&mut inner, state)?;
            let stopping = inner.stop_servers(|id, _| id == plugin_id);
            inner.live.remove(plugin_id);
            self.publish(&mut inner);
            (stopping, removed.source)
        };
        self.stop(stopping).await;
        let mut folders = vec![self.dir.join("data").join(plugin_id)];
        if source != Source::Local {
            folders.push(self.dir.join("installed").join(plugin_id));
        }
        for folder in folders {
            if let Err(e) = remove_dir(&folder) {
                log::warn!(
                    "mcp_host_remove_left_files path={} error={e}",
                    folder.display()
                );
                return Err(format!("{}: {e}", folder.display()));
            }
        }
        Ok(())
    }
}

/// Unpacks the release into `<versions>/<version>/` through a `.partial` folder; it must hold the
/// release's plugin id and version.
fn unpack(versions: &Path, release: &Release, bytes: &[u8]) -> Result<PathBuf, String> {
    let partial = versions.join(format!("{}.partial", release.version));
    let target = versions.join(&release.version);
    fn at(path: &Path) -> impl FnOnce(std::io::Error) -> String + '_ {
        move |e| format!("{}: {e}", path.display())
    }
    remove_dir(&partial).map_err(at(&partial))?;
    let checked = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .and_then(|mut archive| archive.extract(&partial))
        .map_err(|e| format!("plugin unpack failed: {e}"))
        .and_then(|()| manifest::read(&partial))
        .and_then(|m| {
            if m.id == release.id && m.version.as_ref() == Some(&release.version) {
                return Ok(());
            }
            Err(format!(
                "plugin manifest mismatch: expected {} {}, found {} {}",
                release.id,
                release.version,
                m.id,
                m.version.as_deref().unwrap_or("none")
            ))
        });
    if let Err(e) = checked {
        let _ = remove_dir(&partial);
        return Err(e);
    }
    remove_dir(&target).map_err(at(&target))?;
    std::fs::rename(&partial, &target).map_err(at(&target))?;
    Ok(target)
}

/// Deletes the folder and what it holds; a missing folder is fine.
fn remove_dir(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

fn listed(plugin_id: &str) -> String {
    format!("plugin already listed: {plugin_id}")
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::snapshot::{PluginEntry, Status};
    use super::super::store::Source;
    use super::super::test_support::{
        eventually, fixture_copy, host_with, plugin_zip, require_python, temp_dir, TestServer,
    };
    use super::*;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    fn sha256(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Serves `yui-test` `version` and a catalog listing it as official with `sha256`, or the
    /// zip's own hash.
    fn publish_official(server: &TestServer, version: &str, mode: Option<&str>, sha: Option<&str>) {
        let zip = plugin_zip("yui-test", version, mode);
        let path = format!("/yui-test-{version}.zip");
        let catalog = json!({"schema": 1, "official": [{"id": "yui-test", "version": version,
            "summary": "MCP host test plugin.", "assets": {"test-platform": {
                "url": format!("{}{path}", server.url),
                "sha256": sha.map_or_else(|| sha256(&zip), str::to_string)}}}],
            "community": []});
        server.put("/catalog.json", catalog.to_string());
        server.put(&path, zip);
    }

    /// Serves `yui-test` `version` as a community plugin from the repo `owner/yui-test`.
    fn publish_community(server: &TestServer, version: &str) {
        let zip = plugin_zip("yui-test", version, None);
        let asset = format!("yui-test-{version}-test-platform.zip");
        let release = format!("/owner/yui-test/releases/download/v{version}");
        server.put(
            "/catalog.json",
            json!({"schema": 1, "official": [], "community": [
                {"id": "yui-test", "repo": "owner/yui-test", "platforms": ["test-platform"]}]})
            .to_string(),
        );
        server.put(
            "/owner/yui-test/HEAD/.claude-plugin/plugin.json",
            json!({"name": "yui-test", "version": version}).to_string(),
        );
        server.put(
            &format!("{release}/checksums.txt"),
            format!("{}  {asset}\n", sha256(&zip)),
        );
        server.put(&format!("{release}/{asset}"), zip);
    }

    fn only(host: &Host) -> PluginEntry {
        let snapshot = host.snapshot();
        assert_eq!(snapshot.plugins.len(), 1, "{snapshot:?}");
        snapshot.plugins[0].clone()
    }

    #[tokio::test]
    async fn official_install_update_and_remove_follow_the_catalog() {
        require_python();
        let (app_data, server) = (temp_dir(), TestServer::start());
        let (host, _) = host_with(&app_data, server.config());
        let installed = app_data.join("plugins/installed/yui-test");

        publish_official(&server, "0.1.0", None, None);
        host.install("yui-test").await.unwrap();
        let entry = only(&host);
        assert_eq!(
            (entry.source, entry.enabled, entry.consented, entry.path),
            (Source::Official, false, false, installed.join("0.1.0"))
        );
        host.enable("yui-test").await.unwrap();
        assert_eq!(only(&host).servers[0].status, Status::Running);

        publish_official(&server, "0.1.1", None, None);
        host.install("yui-test").await.unwrap();
        let entry = only(&host);
        assert_eq!(
            (entry.consented, entry.path, entry.servers[0].status),
            (true, installed.join("0.1.1"), Status::Running)
        );
        assert!(!installed.join("0.1.0").exists());

        server.requests.lock().unwrap().clear();
        host.install("yui-test").await.unwrap();
        let requests = server.requests.lock().unwrap().clone();
        assert_eq!(requests, ["/catalog.json"]);

        host.remove("yui-test").await.unwrap();
        assert!(host.snapshot().plugins.is_empty());
        assert!(!installed.exists());
        assert!(!app_data.join("plugins/data/yui-test").exists());
    }

    #[tokio::test]
    async fn a_checksum_mismatch_installs_nothing() {
        let (app_data, server) = (temp_dir(), TestServer::start());
        let (host, _) = host_with(&app_data, server.config());
        publish_official(&server, "0.1.0", None, Some(&"0".repeat(64)));
        let before = host.snapshot();
        let refused = host.install("yui-test").await.unwrap_err();
        assert!(refused.starts_with("checksum mismatch: "), "{refused}");
        assert_eq!(host.snapshot(), before);
        let folders =
            std::fs::read_dir(app_data.join("plugins/installed/yui-test")).map_or(0, |d| d.count());
        assert_eq!(folders, 0);
    }

    #[tokio::test]
    async fn a_community_update_waits_for_new_consent() {
        require_python();
        let (app_data, server) = (temp_dir(), TestServer::start());
        let (host, _) = host_with(&app_data, server.config());
        publish_community(&server, "0.1.0");
        host.install("yui-test").await.unwrap();
        host.enable("yui-test").await.unwrap();
        assert_eq!(only(&host).servers[0].status, Status::Running);

        publish_community(&server, "0.1.1");
        host.install("yui-test").await.unwrap();
        let entry = only(&host);
        assert_eq!(
            (
                entry.source,
                entry.enabled,
                entry.consented,
                entry.servers[0].status
            ),
            (Source::Community, true, false, Status::Stopped)
        );
    }

    #[tokio::test]
    async fn catalog_lists_this_platform_and_refuses_an_unknown_schema() {
        let (app_data, server) = (temp_dir(), TestServer::start());
        let (host, _) = host_with(&app_data, server.config());
        let asset = |platform: &str| json!({platform: {"url": "unused", "sha256": "unused"}});
        server.put(
            "/catalog.json",
            json!({"schema": 1,
                "official": [
                    {"id": "here", "version": "1.0.0", "summary": "Built here.",
                        "assets": asset("test-platform")},
                    {"id": "elsewhere", "version": "1.0.0", "summary": "Built elsewhere.",
                        "assets": asset("other-platform")}],
                "community": [
                    {"id": "gone", "repo": "owner/gone", "platforms": ["test-platform"]}]})
            .to_string(),
        );
        let mut listed = serde_json::to_value(host.catalog().await.unwrap()).unwrap();
        let error = listed[1]["error"].take();
        assert!(
            error
                .as_str()
                .is_some_and(|e| e.starts_with("plugin download failed: ")),
            "{error}"
        );
        assert_eq!(
            listed,
            json!([
                {"id": "here", "source": "official", "version": "1.0.0", "summary": "Built here.",
                    "error": null},
                {"id": "gone", "source": "community", "version": null, "summary": null,
                    "error": null}
            ])
        );

        server.put(
            "/catalog.json",
            json!({"schema": 2, "official": [], "community": []}).to_string(),
        );
        assert_eq!(
            host.catalog().await.map(|_| ()),
            Err("unsupported plugin catalog schema: 2".to_string())
        );
    }

    #[tokio::test]
    async fn removing_a_local_plugin_keeps_its_folder() {
        require_python();
        let app_data = temp_dir();
        let (host, _) = host_with(&app_data, TestServer::start().config());
        let folder = fixture_copy("yui-test");
        host.add(folder.clone()).unwrap();
        host.enable("yui-test").await.unwrap();
        host.remove("yui-test").await.unwrap();
        assert!(folder.join(".claude-plugin/plugin.json").is_file());
        assert!(!app_data.join("plugins/data/yui-test").exists());
        assert!(host.snapshot().plugins.is_empty());
    }

    #[tokio::test]
    async fn retry_while_the_old_server_stops_is_refused() {
        require_python();
        let (app_data, server) = (temp_dir(), TestServer::start());
        let (host, _) = host_with(&app_data, server.config());
        publish_official(&server, "0.1.0", Some("linger"), None);
        host.install("yui-test").await.unwrap();
        host.enable("yui-test").await.unwrap();

        publish_official(&server, "0.1.1", None, None);
        let installing = tokio::spawn({
            let host = host.clone();
            async move { host.install("yui-test").await }
        });
        let new_path = app_data.join("plugins/installed/yui-test/0.1.1");
        assert!(
            eventually(|| host
                .snapshot()
                .plugins
                .first()
                .is_some_and(|p| p.path == new_path))
            .await
        );
        assert_eq!(
            host.retry("yui-test/main").await,
            Err("plugin update in progress: yui-test".to_string())
        );
        assert_eq!(installing.await.unwrap(), Ok(()));
        assert_eq!(host.retry("yui-test/main").await, Ok(()));
        host.shutdown().await;
    }
}
