//! The host: the listed plugins, their servers, the stored state, and the published snapshot.

use super::snapshot::Snapshot;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use time::UtcOffset;

type Emit = Box<dyn Fn(&Snapshot) + Send + Sync>;

pub struct Host {
    emit: Emit,
}

impl Host {
    pub fn new(
        app_data: &Path,
        log_dir: &Path,
        offset: UtcOffset,
        emit: impl Fn(&Snapshot) + Send + Sync + 'static,
    ) -> Arc<Self> {
        let _ = (app_data, log_dir, offset);
        Arc::new(Self {
            emit: Box::new(emit),
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            revision: 0,
            plugins: Vec::new(),
        }
    }

    pub fn add(&self, folder: PathBuf) -> Result<String, String> {
        let _ = (folder, &self.emit);
        Err("unimplemented".into())
    }

    pub async fn enable(self: &Arc<Self>, plugin_id: &str) -> Result<(), String> {
        let _ = plugin_id;
        Err("unimplemented".into())
    }

    pub async fn disable(&self, plugin_id: &str) -> Result<(), String> {
        let _ = plugin_id;
        Err("unimplemented".into())
    }

    pub async fn start_enabled(self: &Arc<Self>) {}

    pub async fn shutdown(&self) {}
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::snapshot::{PluginEntry, Status};
    use super::super::test_support::{fixture_copy, has_python, temp_dir};
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
}
