//! The host: the listed plugins, the stored state, the published snapshot, and the commands'
//! entry points.

use super::calls::Calls;
use super::lifecycle::LiveServer;
use super::manifest::{self, Manifest};
use super::server::PluginLog;
use super::snapshot::{self, PluginEntry, ServerView, Snapshot};
use super::store::{self, Source, State, StoredPlugin};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use time::UtcOffset;

type Emit = Box<dyn Fn(&Snapshot) + Send + Sync>;

pub struct Host {
    /// `<app_data>/plugins`.
    pub(super) dir: PathBuf,
    /// `<log dir>/plugins`.
    log_dir: PathBuf,
    offset: UtcOffset,
    emit: Emit,
    inner: Mutex<Inner>,
    pub(super) calls: Calls,
}

pub(super) struct Inner {
    /// `Err` while `state.json` is unreadable: nothing is listed and nothing is written.
    pub(super) state: Result<State, String>,
    pub(super) live: HashMap<String, Live>,
    published: Snapshot,
    pub(super) next_epoch: u64,
}

pub(super) struct Live {
    manifest: Result<Manifest, String>,
    pub(super) log: Arc<PluginLog>,
    pub(super) servers: Vec<LiveServer>,
}

impl Host {
    pub fn new(
        app_data: Result<PathBuf, String>,
        log_dir: &Path,
        offset: UtcOffset,
        emit: impl Fn(&Snapshot) + Send + Sync + 'static,
    ) -> Arc<Self> {
        // Without an app data dir the state is `Err`, so nothing ever reads or writes `dir`.
        let dir = app_data.as_deref().unwrap_or(Path::new("")).join("plugins");
        let log_dir = log_dir.join("plugins");
        let state = app_data.and_then(|_| {
            let loaded = store::load(&dir.join("state.json"));
            if let Err(e) = &loaded {
                log::error!("mcp_host_state_unreadable error={e}");
            }
            loaded
        });
        let live = state
            .iter()
            .flat_map(|s| &s.plugins)
            .map(|p| (p.id.clone(), Live::read(p, &log_dir, offset)))
            .collect();
        let mut inner = Inner {
            state,
            live,
            published: Snapshot {
                revision: 0,
                plugins: Vec::new(),
            },
            next_epoch: 0,
        };
        inner.published.plugins = inner.entries();
        Arc::new(Self {
            dir,
            log_dir,
            offset,
            emit: Box::new(emit),
            inner: Mutex::new(inner),
            calls: Calls::default(),
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        self.lock().published.clone()
    }

    pub fn log_tail(&self, plugin_id: &str) -> Result<Vec<String>, String> {
        let inner = self.lock();
        let live = inner
            .live
            .get(plugin_id)
            .ok_or_else(|| unknown(plugin_id))?;
        Ok(live.log.tail())
    }

    /// Lists the plugin in `folder` as disabled and without consent.
    pub fn add(&self, folder: PathBuf) -> Result<String, String> {
        let mut inner = self.lock();
        let mut state = writable(&inner.state)?.clone();
        let manifest = manifest::read(&folder)?;
        let id = manifest.id.clone();
        if state.plugin(&id).is_some() {
            return Err(format!("plugin already listed: {id}"));
        }
        let plugin = StoredPlugin {
            id: id.clone(),
            source: Source::Local,
            path: folder,
            enabled: false,
            approved_path: None,
            enabled_seq: None,
        };
        let live = Live::new(&plugin, Ok(manifest), &self.log_dir, self.offset);
        state.plugins.push(plugin);
        self.save(&mut inner, state)?;
        inner.live.insert(id.clone(), live);
        self.publish(&mut inner);
        Ok(id)
    }

    /// Records consent to the plugin's current path, enables it, and starts its servers.
    pub async fn enable(self: &Arc<Self>, plugin_id: &str) -> Result<(), String> {
        let tickets = {
            let mut inner = self.lock();
            let mut state = writable(&inner.state)?.clone();
            let next_seq = state.next_seq;
            let plugin = state
                .plugin_mut(plugin_id)
                .ok_or_else(|| unknown(plugin_id))?;
            if plugin.enabled && plugin.consented() {
                return Ok(());
            }
            plugin.enabled = true;
            plugin.approved_path = Some(plugin.path.clone());
            plugin.enabled_seq = Some(next_seq);
            let live = Live::read(plugin, &self.log_dir, self.offset);
            state.next_seq += 1;
            self.save(&mut inner, state)?;
            inner.live.insert(plugin_id.to_string(), live);
            let tickets = inner.tickets(plugin_id, |_| true);
            self.publish(&mut inner);
            tickets
        };
        self.start(tickets).await;
        Ok(())
    }

    pub async fn disable(&self, plugin_id: &str) -> Result<(), String> {
        let stopping = {
            let mut inner = self.lock();
            let mut state = writable(&inner.state)?.clone();
            state
                .plugin_mut(plugin_id)
                .ok_or_else(|| unknown(plugin_id))?
                .enabled = false;
            self.save(&mut inner, state)?;
            let stopping = inner.stop_servers(|id, _| id == plugin_id);
            self.publish(&mut inner);
            stopping
        };
        self.stop(stopping).await;
        Ok(())
    }

    /// Stops the server if it runs, then starts it again; its plugin must be enabled.
    pub async fn retry(self: &Arc<Self>, server_id: &str) -> Result<(), String> {
        let (stopping, tickets) = {
            let mut inner = self.lock();
            let plugin_id = server_id.split_once('/').map_or(server_id, |(id, _)| id);
            let active = writable(&inner.state)?
                .plugin(plugin_id)
                .is_some_and(|p| p.enabled && p.consented());
            let known = inner
                .live
                .get(plugin_id)
                .is_some_and(|live| live.servers.iter().any(|ls| ls.entry.id == server_id));
            if !known {
                return Err(format!("unknown plugin server: {server_id}"));
            }
            if !active {
                return Err(format!("plugin not enabled: {plugin_id}"));
            }
            let stopping = inner.stop_servers(|_, ls| ls.entry.id == server_id);
            let tickets = inner.tickets(plugin_id, |ls| ls.entry.id == server_id);
            self.publish(&mut inner);
            (stopping, tickets)
        };
        self.stop(stopping).await;
        self.start(tickets).await;
        Ok(())
    }

    /// Starts every enabled plugin whose consent holds.
    pub async fn start_enabled(self: &Arc<Self>) {
        let tickets = {
            let mut inner = self.lock();
            let ids: Vec<String> = inner
                .state
                .iter()
                .flat_map(|s| &s.plugins)
                .filter(|p| p.enabled && p.consented())
                .map(|p| p.id.clone())
                .collect();
            let tickets: Vec<_> = ids
                .iter()
                .flat_map(|id| inner.tickets(id, |_| true))
                .collect();
            self.publish(&mut inner);
            tickets
        };
        self.start_per_plugin(tickets).await;
    }

    /// Calls a declared tool; hidden and unknown names are refused.
    pub async fn call(
        &self,
        window: &str,
        call_id: &str,
        name: &str,
        arguments: serde_json::Value,
        preset_id: &str,
    ) -> Result<serde_json::Value, String> {
        // Registered under the host lock, so a stop that takes this server afterwards cancels it.
        let (call, peer, tool) = {
            let inner = self.lock();
            inner
                .published
                .plugins
                .iter()
                .flat_map(|p| p.tools.iter().map(move |t| (&p.id, t)))
                .find(|(_, t)| t.name == name)
                .and_then(|(plugin_id, tool)| {
                    let ls = inner.live.get(plugin_id)?.servers.iter();
                    let server = ls
                        .filter(|ls| ls.entry.id == tool.server)
                        .find_map(|ls| ls.running.as_ref())?;
                    Some((server.peer().clone(), tool.clone()))
                })
                .ok_or_else(|| format!("unknown plugin tool: {name}"))
                .and_then(|(peer, tool)| {
                    let call = self.calls.register(window, call_id, &tool.server)?;
                    Ok((call, peer, tool))
                })?
        };
        self.calls
            .call(call, &peer, &tool, arguments, preset_id)
            .await
    }

    pub fn cancel(&self, window: &str, call_id: &str) {
        self.calls.cancel(window, call_id);
    }

    /// Cancels every call the window started; runs when the window is destroyed.
    pub fn cancel_window(&self, window: &str) {
        self.calls.cancel_window(window);
    }

    /// The body of a declared skill, read from disk now; hidden and unknown names are refused.
    pub fn skill(&self, name: &str) -> Result<String, String> {
        let path = {
            let inner = self.lock();
            inner
                .published
                .plugins
                .iter()
                .find(|p| p.skills.iter().any(|s| s.name == name))
                .and_then(|p| inner.live.get(&p.id)?.manifest.as_ref().ok())
                .and_then(|m| m.skills.iter().find(|s| s.name == name))
                .map(|s| s.path.clone())
                .ok_or_else(|| format!("unknown plugin skill: {name}"))?
        };
        manifest::skill_body(&path)
    }

    /// Stops every server without publishing.
    pub async fn shutdown(&self) {
        let stopping = self.lock().stop_servers(|_, _| true);
        self.stop(stopping).await;
    }

    fn save(&self, inner: &mut Inner, state: State) -> Result<(), String> {
        store::save(&self.dir.join("state.json"), &state)
            .map_err(|e| format!("plugin state write failed: {e}"))?;
        inner.state = Ok(state);
        Ok(())
    }

    /// Emits a new revision when the snapshot changed.
    pub(super) fn publish(&self, inner: &mut Inner) {
        let plugins = inner.entries();
        if plugins == inner.published.plugins {
            return;
        }
        inner.published = Snapshot {
            revision: inner.published.revision + 1,
            plugins,
        };
        (self.emit)(&inner.published);
    }

    pub(super) fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Inner {
    fn entries(&self) -> Vec<PluginEntry> {
        let Ok(state) = &self.state else {
            return Vec::new();
        };
        let mut entries: Vec<PluginEntry> = state
            .plugins
            .iter()
            .filter_map(|p| {
                let live = self.live.get(&p.id)?;
                let views: Vec<ServerView> = live
                    .servers
                    .iter()
                    .map(|ls| ServerView {
                        entry: &ls.entry,
                        tools: ls.running.as_ref().map_or(&[], |s| &s.tools),
                    })
                    .collect();
                Some(snapshot::plugin_entry(p, &live.manifest, &views))
            })
            .collect();
        snapshot::resolve(&mut entries);
        entries
    }
}

impl Live {
    fn read(plugin: &StoredPlugin, log_dir: &Path, offset: UtcOffset) -> Self {
        Self::new(plugin, manifest::read(&plugin.path), log_dir, offset)
    }

    fn new(
        plugin: &StoredPlugin,
        manifest: Result<Manifest, String>,
        log_dir: &Path,
        offset: UtcOffset,
    ) -> Self {
        let servers = manifest
            .iter()
            .flat_map(|m| &m.servers)
            .map(|spec| LiveServer::new(&plugin.id, spec))
            .collect();
        Self {
            manifest,
            log: Arc::new(PluginLog::new(log_dir.to_path_buf(), &plugin.id, offset)),
            servers,
        }
    }
}

fn writable(state: &Result<State, String>) -> Result<&State, String> {
    state
        .as_ref()
        .map_err(|e| format!("plugin state unreadable: {e}"))
}

fn unknown(plugin_id: &str) -> String {
    format!("unknown plugin: {plugin_id}")
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::snapshot::{PluginEntry, Status};
    use super::super::test_support::{fixture_copy, host_at, require_python, running, temp_dir};
    use super::*;
    use serde_json::{json, Value};

    fn plugin<'a>(snapshot: &'a Snapshot, id: &str) -> &'a PluginEntry {
        snapshot
            .plugins
            .iter()
            .find(|p| p.id == id)
            .unwrap_or_else(|| panic!("{id} not listed: {snapshot:?}"))
    }

    fn tool_names(entry: &PluginEntry) -> Vec<&str> {
        entry.tools.iter().map(|t| t.name.as_str()).collect()
    }

    #[tokio::test]
    async fn enable_records_consent_that_a_new_host_honours_until_the_path_changes() {
        require_python();
        let app_data = temp_dir();
        let folder = fixture_copy("yui-test");
        let (host, _) = host_at(&app_data);
        assert_eq!(host.add(folder.clone()), Ok("yui-test".to_string()));
        host.enable("yui-test").await.unwrap();
        host.shutdown().await;
        let state_path = app_data.join("plugins/state.json");
        let stored: Value =
            serde_json::from_str(&std::fs::read_to_string(&state_path).unwrap()).unwrap();
        assert_eq!(
            stored,
            json!({"plugins": [{"id": "yui-test", "source": "local", "path": folder,
                "enabled": true, "approvedPath": folder, "enabledSeq": 0}], "nextSeq": 1})
        );

        let (again, _) = host_at(&app_data);
        again.start_enabled().await;
        let entry = plugin(&again.snapshot(), "yui-test").clone();
        again.shutdown().await;
        assert!(entry.enabled && entry.consented);
        assert_eq!(entry.servers[0].status, Status::Running);

        let moved = fixture_copy("yui-test");
        let mut stored = stored;
        stored["plugins"][0]["path"] = json!(moved);
        std::fs::write(&state_path, stored.to_string()).unwrap();
        let (elsewhere, _) = host_at(&app_data);
        elsewhere.start_enabled().await;
        let entry = plugin(&elsewhere.snapshot(), "yui-test").clone();
        assert_eq!(entry.path, moved);
        assert!(entry.enabled && !entry.consented);
        assert_eq!(entry.servers[0].status, Status::Stopped);
    }

    #[tokio::test]
    async fn a_later_plugin_runs_but_its_colliding_names_stay_hidden_until_the_holder_turns_off() {
        require_python();
        let app_data = temp_dir();
        let (host, _) = host_at(&app_data);
        for id in ["yui-a", "yui-b"] {
            host.add(fixture_copy(id)).unwrap();
            host.enable(id).await.unwrap();
        }
        let snapshot = host.snapshot();
        let (a, b) = (plugin(&snapshot, "yui-a"), plugin(&snapshot, "yui-b"));
        assert_eq!(b.servers[0].status, Status::Running);
        assert_eq!(
            tool_names(a),
            ["echo_args", "echo_meta", "slow", "spawn_child"]
        );
        assert_eq!(
            serde_json::to_value(&a.hidden).unwrap(),
            json!([{"kind": "tool", "name": "look", "holder": "builtin"}])
        );
        assert!(b.tools.is_empty() && b.skills.is_empty());
        assert_eq!(
            serde_json::to_value(&b.hidden).unwrap(),
            json!([
                {"kind": "tool", "name": "echo_args", "holder": "yui-a"},
                {"kind": "tool", "name": "echo_meta", "holder": "yui-a"},
                {"kind": "tool", "name": "slow", "holder": "yui-a"},
                {"kind": "tool", "name": "spawn_child", "holder": "yui-a"},
                {"kind": "tool", "name": "look", "holder": "builtin"},
                {"kind": "skill", "name": "hello", "holder": "yui-a"}
            ])
        );

        host.disable("yui-a").await.unwrap();
        let after = host.snapshot();
        let b = plugin(&after, "yui-b");
        assert_eq!(
            tool_names(b),
            ["echo_args", "echo_meta", "slow", "spawn_child"]
        );
        assert_eq!(b.skills[0].name, "hello");
        assert_eq!(
            serde_json::to_value(&b.hidden).unwrap(),
            json!([{"kind": "tool", "name": "look", "holder": "builtin"}])
        );
        host.shutdown().await;
    }

    #[tokio::test]
    async fn every_change_emits_one_snapshot_one_revision_higher() {
        require_python();
        let app_data = temp_dir();
        let (host, emitted) = host_at(&app_data);
        assert_eq!(host.snapshot().revision, 0);
        host.add(fixture_copy("yui-test")).unwrap();
        host.enable("yui-test").await.unwrap();
        host.disable("yui-test").await.unwrap();
        let emitted = emitted.lock().unwrap();
        let revisions: Vec<u64> = emitted.iter().map(|s| s.revision).collect();
        assert_eq!(revisions, [1, 2, 3, 4]);
        let statuses: Vec<Status> = emitted
            .iter()
            .map(|s| s.plugins[0].servers[0].status)
            .collect();
        assert_eq!(
            statuses,
            [
                Status::Stopped,
                Status::Starting,
                Status::Running,
                Status::Stopped
            ]
        );
        assert_eq!(host.snapshot(), emitted[3]);
    }

    #[test]
    fn invalid_state_json_moves_aside_and_the_host_starts_empty() {
        let app_data = temp_dir();
        let plugins = app_data.join("plugins");
        std::fs::create_dir_all(&plugins).unwrap();
        std::fs::write(plugins.join("state.json"), "{not json").unwrap();
        let (host, _) = host_at(&app_data);
        assert!(host.snapshot().plugins.is_empty());
        assert!(!plugins.join("state.json").exists());
        assert_eq!(
            std::fs::read_to_string(plugins.join("state.json.bad")).unwrap(),
            "{not json"
        );
        assert_eq!(
            host.add(fixture_copy("yui-test")),
            Ok("yui-test".to_string())
        );
    }

    #[tokio::test]
    async fn an_unreadable_state_file_lists_nothing_and_refuses_every_write() {
        let app_data = temp_dir();
        let state_path = app_data.join("plugins/state.json");
        std::fs::create_dir_all(&state_path).unwrap();
        let (host, _) = host_at(&app_data);
        assert!(host.snapshot().plugins.is_empty());
        let refused = host.enable("yui-test").await.unwrap_err();
        assert!(
            refused.starts_with("plugin state unreadable: "),
            "{refused}"
        );
        let refused = host.add(fixture_copy("yui-test")).unwrap_err();
        assert!(
            refused.starts_with("plugin state unreadable: "),
            "{refused}"
        );
        assert!(state_path.is_dir());
    }

    #[tokio::test]
    async fn skill_reads_a_body_and_an_unknown_skill_or_a_hidden_tool_is_refused() {
        require_python();
        let host = running("yui-test").await;
        assert_eq!(
            host.skill("hello"),
            Ok("Say hello to the user.".to_string())
        );
        assert_eq!(
            host.skill("nope"),
            Err("unknown plugin skill: nope".to_string())
        );
        assert_eq!(
            host.call("pet-a", "c1", "look", json!({}), "preset-1")
                .await,
            Err("unknown plugin tool: look".to_string())
        );
        host.shutdown().await;
    }

    #[tokio::test]
    async fn without_an_app_data_dir_the_host_lists_nothing_and_refuses_every_write() {
        let host = Host::new(
            Err("no home folder".into()),
            &temp_dir(),
            UtcOffset::UTC,
            |_| {},
        );
        assert!(host.snapshot().plugins.is_empty());
        let refused = Err("plugin state unreadable: no home folder".to_string());
        assert_eq!(host.enable("yui-test").await, refused);
        assert_eq!(host.add(fixture_copy("yui-test")).map(|_| ()), refused);
    }
}
