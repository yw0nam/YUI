//! The host: the listed plugins, their servers, the stored state, and the published snapshot.

use super::manifest::{self, Manifest, ServerSpec};
use super::server::{self, PluginLog, Server};
use super::snapshot::{self, PluginEntry, ServerEntry, SkillEntry, Snapshot, Status, ToolEntry};
use super::store::{self, Source, State, StoredPlugin};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use time::UtcOffset;

/// Spawn, `initialize` and `tools/list` together.
const STARTUP_DEADLINE: Duration = Duration::from_secs(30);

type Emit = Box<dyn Fn(&Snapshot) + Send + Sync>;

pub struct Host {
    /// `<app_data>/plugins`.
    dir: PathBuf,
    /// `<log dir>/plugins`.
    log_dir: PathBuf,
    offset: UtcOffset,
    emit: Emit,
    inner: Mutex<Inner>,
}

struct Inner {
    /// `Err` while `state.json` is unreadable: nothing is listed and nothing is written.
    state: Result<State, String>,
    live: HashMap<String, Live>,
    published: Snapshot,
    /// Tags each server start; a start or exit whose tag is stale is dropped.
    next_epoch: u64,
}

struct Live {
    manifest: Result<Manifest, String>,
    log: Arc<PluginLog>,
    servers: Vec<LiveServer>,
}

struct LiveServer {
    spec: ServerSpec,
    entry: ServerEntry,
    epoch: u64,
    running: Option<Server>,
}

/// One server start, prepared under the lock and run outside it.
struct Ticket {
    plugin_id: String,
    server_id: String,
    spec: ServerSpec,
    root: PathBuf,
    log: Arc<PluginLog>,
    epoch: u64,
}

impl Host {
    pub fn new(
        app_data: &Path,
        log_dir: &Path,
        offset: UtcOffset,
        emit: impl Fn(&Snapshot) + Send + Sync + 'static,
    ) -> Arc<Self> {
        let dir = app_data.join("plugins");
        let log_dir = log_dir.join("plugins");
        let state = store::load(&dir.join("state.json"));
        if let Err(e) = &state {
            log::error!("mcp_host_state_unreadable error={e}");
        }
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
        if state.plugins.iter().any(|p| p.id == id) {
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
                .plugins
                .iter_mut()
                .find(|p| p.id == plugin_id)
                .ok_or_else(|| unknown(plugin_id))?;
            if plugin.enabled && consented(plugin) {
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
        for ticket in tickets {
            self.run(ticket).await;
        }
        Ok(())
    }

    pub async fn disable(&self, plugin_id: &str) -> Result<(), String> {
        let stopping = {
            let mut inner = self.lock();
            let mut state = writable(&inner.state)?.clone();
            let plugin = state
                .plugins
                .iter_mut()
                .find(|p| p.id == plugin_id)
                .ok_or_else(|| unknown(plugin_id))?;
            plugin.enabled = false;
            self.save(&mut inner, state)?;
            let stopping = inner.stop_all(Some(plugin_id));
            self.publish(&mut inner);
            stopping
        };
        for server in stopping {
            server.stop().await;
        }
        Ok(())
    }

    /// Stops the server if it runs, then starts it again; its plugin must be enabled.
    pub async fn retry(self: &Arc<Self>, server_id: &str) -> Result<(), String> {
        let (old, tickets) = {
            let mut inner = self.lock();
            let plugin_id = server_id.split_once('/').map_or(server_id, |(id, _)| id);
            let active = writable(&inner.state)?
                .plugins
                .iter()
                .any(|p| p.id == plugin_id && p.enabled && consented(p));
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
            let old = inner
                .live
                .get_mut(plugin_id)
                .and_then(|live| live.servers.iter_mut().find(|ls| ls.entry.id == server_id))
                .and_then(|ls| ls.running.take());
            let tickets = inner.tickets(plugin_id, |ls| ls.entry.id == server_id);
            self.publish(&mut inner);
            (old, tickets)
        };
        if let Some(server) = old {
            server.stop().await;
        }
        for ticket in tickets {
            self.run(ticket).await;
        }
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
                .filter(|p| p.enabled && consented(p))
                .map(|p| p.id.clone())
                .collect();
            let tickets: Vec<Ticket> = ids
                .iter()
                .flat_map(|id| inner.tickets(id, |_| true))
                .collect();
            self.publish(&mut inner);
            tickets
        };
        for ticket in tickets {
            self.run(ticket).await;
        }
    }

    pub async fn call(
        &self,
        window: &str,
        call_id: &str,
        name: &str,
        arguments: serde_json::Value,
        preset_id: &str,
    ) -> Result<serde_json::Value, String> {
        let _ = (window, call_id, name, arguments, preset_id);
        Err("unimplemented".into())
    }

    pub fn cancel(&self, window: &str, call_id: &str) {
        let _ = (window, call_id);
    }

    pub fn cancel_window(&self, window: &str) {
        let _ = window;
    }

    pub fn skill(&self, name: &str) -> Result<String, String> {
        let _ = name;
        Err("unimplemented".into())
    }

    /// Stops every server without publishing.
    pub async fn shutdown(&self) {
        let stopping = self.lock().stop_all(None);
        for server in stopping {
            server.stop().await;
        }
    }

    async fn run(self: &Arc<Self>, ticket: Ticket) {
        let host = Arc::downgrade(self);
        let (plugin_id, server_id, epoch) = (
            ticket.plugin_id.clone(),
            ticket.server_id.clone(),
            ticket.epoch,
        );
        let started = server::start(
            &ticket.spec,
            &ticket.root,
            &self.dir.join("data").join(&ticket.plugin_id),
            ticket.log,
            STARTUP_DEADLINE,
            move |reason| {
                if let Some(host) = host.upgrade() {
                    host.exited(&plugin_id, &server_id, epoch, reason);
                }
            },
        )
        .await;
        let stale = {
            let mut inner = self.lock();
            match inner.server_mut(&ticket.plugin_id, &ticket.server_id, epoch) {
                None => started.ok(),
                Some(ls) => {
                    let stale = match started {
                        // An exit that landed before this point already set `exited`.
                        Ok(server) if ls.entry.status == Status::Starting => {
                            ls.entry.status = Status::Running;
                            ls.running = Some(server);
                            None
                        }
                        Ok(server) => Some(server),
                        Err(failure) => {
                            ls.entry.status = Status::Failed;
                            ls.entry.phase = Some(failure.phase);
                            ls.entry.reason = Some(failure.reason);
                            None
                        }
                    };
                    self.publish(&mut inner);
                    stale
                }
            }
        };
        if let Some(server) = stale {
            server.stop().await;
        }
    }

    fn exited(&self, plugin_id: &str, server_id: &str, epoch: u64, reason: String) {
        let mut inner = self.lock();
        let Some(ls) = inner.server_mut(plugin_id, server_id, epoch) else {
            return;
        };
        ls.entry.status = Status::Exited;
        ls.entry.reason = Some(reason);
        // The child is gone; dropping the handle releases the connection.
        drop(ls.running.take());
        self.publish(&mut inner);
    }

    fn save(&self, inner: &mut Inner, state: State) -> Result<(), String> {
        store::save(&self.dir.join("state.json"), &state)
            .map_err(|e| format!("plugin state write failed: {e}"))?;
        inner.state = Ok(state);
        Ok(())
    }

    /// Emits a new revision when the snapshot changed.
    fn publish(&self, inner: &mut Inner) {
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

    fn lock(&self) -> MutexGuard<'_, Inner> {
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
            .filter_map(|p| Some(entry(p, self.live.get(&p.id)?)))
            .collect();
        snapshot::resolve(&mut entries);
        entries
    }

    /// Marks the matching servers of `plugin_id` as starting and returns their tickets.
    fn tickets(&mut self, plugin_id: &str, which: impl Fn(&LiveServer) -> bool) -> Vec<Ticket> {
        let root = self
            .state
            .iter()
            .flat_map(|s| &s.plugins)
            .find(|p| p.id == plugin_id)
            .map(|p| p.path.clone());
        let (Some(root), Some(live)) = (root, self.live.get_mut(plugin_id)) else {
            return Vec::new();
        };
        let mut tickets = Vec::new();
        for ls in live.servers.iter_mut().filter(|ls| which(ls)) {
            self.next_epoch += 1;
            ls.epoch = self.next_epoch;
            ls.entry.status = Status::Starting;
            ls.entry.phase = None;
            ls.entry.reason = None;
            tickets.push(Ticket {
                plugin_id: plugin_id.to_string(),
                server_id: ls.entry.id.clone(),
                spec: ls.spec.clone(),
                root: root.clone(),
                log: live.log.clone(),
                epoch: ls.epoch,
            });
        }
        tickets
    }

    /// Marks the servers of one plugin, or of all, as stopped and hands back the running ones.
    fn stop_all(&mut self, plugin_id: Option<&str>) -> Vec<Server> {
        let mut stopping = Vec::new();
        for (id, live) in &mut self.live {
            if plugin_id.is_some_and(|p| p != id) {
                continue;
            }
            for ls in &mut live.servers {
                self.next_epoch += 1;
                ls.epoch = self.next_epoch;
                ls.entry.status = Status::Stopped;
                ls.entry.phase = None;
                ls.entry.reason = None;
                stopping.extend(ls.running.take());
            }
        }
        stopping
    }

    fn server_mut(
        &mut self,
        plugin_id: &str,
        server_id: &str,
        epoch: u64,
    ) -> Option<&mut LiveServer> {
        self.live
            .get_mut(plugin_id)?
            .servers
            .iter_mut()
            .find(|ls| ls.entry.id == server_id && ls.epoch == epoch)
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
            .map(|spec| LiveServer {
                spec: spec.clone(),
                entry: ServerEntry {
                    id: format!("{}/{}", plugin.id, spec.name),
                    name: spec.name.clone(),
                    status: Status::Stopped,
                    phase: None,
                    reason: None,
                },
                epoch: 0,
                running: None,
            })
            .collect();
        Self {
            manifest,
            log: Arc::new(PluginLog::new(log_dir.to_path_buf(), &plugin.id, offset)),
            servers,
        }
    }
}

fn entry(plugin: &StoredPlugin, live: &Live) -> PluginEntry {
    let consented = consented(plugin);
    let active = plugin.enabled && consented;
    let manifest = live.manifest.as_ref().ok();
    let tools = live
        .servers
        .iter()
        .filter_map(|ls| Some((ls, ls.running.as_ref()?)))
        .flat_map(|(ls, server)| {
            server.tools.iter().map(|tool| ToolEntry {
                name: tool.name.to_string(),
                server: ls.entry.id.clone(),
                description: tool.description.as_ref().map(|d| d.to_string()),
                input_schema: serde_json::Value::Object((*tool.input_schema).clone()),
                meta: tool
                    .meta
                    .as_ref()
                    .and_then(|m| serde_json::to_value(m).ok()),
            })
        })
        .collect();
    let skills = manifest
        .filter(|_| active)
        .iter()
        .flat_map(|m| &m.skills)
        .map(|s| SkillEntry {
            name: s.name.clone(),
            description: s.description.clone(),
        })
        .collect();
    PluginEntry {
        id: plugin.id.clone(),
        version: manifest.and_then(|m| m.version.clone()),
        description: manifest.and_then(|m| m.description.clone()),
        source: plugin.source,
        path: plugin.path.clone(),
        enabled: plugin.enabled,
        consented,
        error: live.manifest.as_ref().err().cloned(),
        servers: live.servers.iter().map(|ls| ls.entry.clone()).collect(),
        tools,
        skills,
        hidden: Vec::new(),
        enabled_seq: plugin.enabled_seq,
    }
}

fn consented(plugin: &StoredPlugin) -> bool {
    plugin.approved_path.as_ref() == Some(&plugin.path)
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
    use super::super::test_support::{eventually, fixture_copy, has_python, temp_dir};
    use super::*;
    use serde_json::{json, Value};
    use std::sync::Mutex;

    type Emitted = Arc<Mutex<Vec<Snapshot>>>;

    fn host_at(app_data: &Path) -> (Arc<Host>, Emitted) {
        let emitted = Emitted::default();
        let sink = emitted.clone();
        let host = Host::new(app_data, &app_data.join("logs"), UtcOffset::UTC, move |s| {
            sink.lock().unwrap().push(s.clone())
        });
        (host, emitted)
    }

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
        if !has_python() {
            return;
        }
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
        if !has_python() {
            return;
        }
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
        assert!(after.revision > snapshot.revision);
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
        if !has_python() {
            return;
        }
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

    async fn running(id: &str) -> Arc<Host> {
        let (host, _) = host_at(&temp_dir());
        host.add(fixture_copy(id)).unwrap();
        host.enable(id).await.unwrap();
        host
    }

    fn slow_call(
        host: &Arc<Host>,
        window: &'static str,
        call_id: &'static str,
    ) -> tokio::task::JoinHandle<Result<Value, String>> {
        let host = host.clone();
        tokio::spawn(async move {
            host.call(window, call_id, "slow", json!({}), "preset-1")
                .await
        })
    }

    #[tokio::test]
    async fn a_call_carries_the_preset_in_its_meta() {
        if !has_python() {
            return;
        }
        let host = running("yui-test").await;
        let result = host
            .call("pet-a", "c1", "echo_meta", json!({}), "preset-1")
            .await
            .unwrap();
        host.shutdown().await;
        assert_eq!(result["isError"], false);
        let meta: Value =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(meta["io.github.yw0nam.yui/preset"], "preset-1");
    }

    #[tokio::test]
    async fn a_call_times_out_at_the_tools_wait_ms_and_cancels_it() {
        if !has_python() {
            return;
        }
        let host = running("yui-test").await;
        let began = std::time::Instant::now();
        let result = host
            .call("pet-a", "c1", "slow", json!({}), "preset-1")
            .await;
        let took = began.elapsed();
        assert_eq!(
            result,
            Err("plugin tool timed out after 1500 ms".to_string())
        );
        assert!(
            took >= Duration::from_millis(1500) && took < Duration::from_secs(5),
            "{took:?}"
        );
        let cancelled = || {
            host.log_tail("yui-test")
                .unwrap()
                .iter()
                .any(|l| l.starts_with("[main] cancelled id="))
        };
        assert!(
            eventually(cancelled).await,
            "{:?}",
            host.log_tail("yui-test")
        );
        host.shutdown().await;
    }

    #[tokio::test]
    async fn a_window_cancels_only_its_own_calls() {
        if !has_python() {
            return;
        }
        let host = running("yui-test").await;
        let first = slow_call(&host, "pet-a", "c1");
        tokio::time::sleep(Duration::from_millis(300)).await;
        host.cancel("pet-b", "c1");
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!first.is_finished());
        host.cancel("pet-a", "c1");
        let ended = tokio::time::timeout(Duration::from_secs(1), first).await;
        assert_eq!(
            ended.unwrap().unwrap(),
            Err("plugin tool cancelled".to_string())
        );

        let (second, third, other) = (
            slow_call(&host, "pet-a", "c2"),
            slow_call(&host, "pet-a", "c3"),
            slow_call(&host, "pet-b", "c4"),
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        host.cancel_window("pet-a");
        for call in [second, third] {
            let ended = tokio::time::timeout(Duration::from_secs(1), call).await;
            assert_eq!(
                ended.unwrap().unwrap(),
                Err("plugin tool cancelled".to_string())
            );
        }
        assert!(!other.is_finished());
        host.shutdown().await;
    }

    #[tokio::test]
    async fn skill_reads_a_declared_body_and_hidden_or_unknown_names_are_refused() {
        if !has_python() {
            return;
        }
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
}
