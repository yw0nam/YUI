//! Server starts and stops: tickets tagged with an epoch, start results, exits, and stops.

use super::host::{Host, Inner};
use super::launch;
use super::manifest::ServerSpec;
use super::server::{self, PluginLog, Server, Stopper};
use super::snapshot::{ServerEntry, Status};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Spawn, `initialize` and `tools/list` together.
const STARTUP_DEADLINE: Duration = Duration::from_secs(30);

pub struct LiveServer {
    pub spec: ServerSpec,
    pub entry: ServerEntry,
    /// Tags the latest start or stop; a start or exit with another tag is dropped.
    epoch: u64,
    pub running: Option<Server>,
    /// Stops a server that is spawned but not running yet.
    starting: Option<Stopper>,
}

impl LiveServer {
    pub fn new(plugin_id: &str, spec: &ServerSpec, root: &Path, data: &Path) -> Self {
        Self {
            spec: spec.clone(),
            entry: ServerEntry {
                id: format!("{plugin_id}/{}", spec.name),
                name: spec.name.clone(),
                command: launch::display(spec, root, data),
                status: Status::Stopped,
                phase: None,
                reason: None,
            },
            epoch: 0,
            running: None,
            starting: None,
        }
    }
}

/// What a stop takes: running servers with their ids, and servers still starting.
#[derive(Default)]
pub struct Stopping {
    running: Vec<(String, Server)>,
    starting: Vec<Stopper>,
}

/// One server start, prepared under the lock and run outside it.
pub struct Ticket {
    plugin_id: String,
    server_id: String,
    spec: ServerSpec,
    root: PathBuf,
    log: Arc<PluginLog>,
    epoch: u64,
}

impl Inner {
    /// Marks the matching servers of `plugin_id` as starting and returns their tickets.
    pub fn tickets(&mut self, plugin_id: &str, which: impl Fn(&LiveServer) -> bool) -> Vec<Ticket> {
        let root = self
            .state
            .as_ref()
            .ok()
            .and_then(|s| s.plugin(plugin_id))
            .map(|p| p.path.clone());
        let (Some(root), Some(live)) = (root, self.live.get_mut(plugin_id)) else {
            return Vec::new();
        };
        let mut tickets = Vec::new();
        for ls in live.servers.iter_mut().filter(|ls| which(ls)) {
            self.next_epoch += 1;
            ls.epoch = self.next_epoch;
            ls.entry.reset(Status::Starting);
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

    /// Marks the matching servers as stopped and hands back what must be stopped.
    pub fn stop_servers(&mut self, which: impl Fn(&str, &LiveServer) -> bool) -> Stopping {
        let mut stopping = Stopping::default();
        for (plugin_id, live) in &mut self.live {
            for ls in live.servers.iter_mut().filter(|ls| which(plugin_id, ls)) {
                self.next_epoch += 1;
                ls.epoch = self.next_epoch;
                ls.entry.reset(Status::Stopped);
                let id = ls.entry.id.clone();
                stopping
                    .running
                    .extend(ls.running.take().map(|server| (id, server)));
                stopping.starting.extend(ls.starting.take());
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

impl Host {
    /// Runs the tickets one after another.
    pub(super) async fn start(self: &Arc<Self>, tickets: Vec<Ticket>) {
        for ticket in tickets {
            self.run(ticket).await;
        }
    }

    /// Runs each plugin's tickets as its own task, so one hanging plugin holds back no other.
    pub(super) async fn start_per_plugin(self: &Arc<Self>, tickets: Vec<Ticket>) {
        let mut groups: Vec<Vec<Ticket>> = Vec::new();
        for ticket in tickets {
            match groups.last_mut() {
                Some(group) if group[0].plugin_id == ticket.plugin_id => group.push(ticket),
                _ => groups.push(vec![ticket]),
            }
        }
        let tasks: Vec<_> = groups
            .into_iter()
            .map(|group| {
                let host = self.clone();
                tokio::spawn(async move { host.start(group).await })
            })
            .collect();
        for task in tasks {
            let _ = task.await;
        }
    }

    /// Stops starting servers, cancels running servers' calls, then stops those together.
    pub(super) async fn stop(&self, stopping: Stopping) {
        for starting in stopping.starting {
            starting.stop();
        }
        for (server_id, _) in &stopping.running {
            self.calls.cancel_server(server_id).await;
        }
        let stops: Vec<_> = stopping
            .running
            .into_iter()
            .map(|(_, server)| tokio::spawn(server.stop()))
            .collect();
        for stop in stops {
            let _ = stop.await;
        }
    }

    async fn run(self: &Arc<Self>, ticket: Ticket) {
        let host = Arc::downgrade(self);
        let (plugin_id, server_id, epoch) = (
            ticket.plugin_id.clone(),
            ticket.server_id.clone(),
            ticket.epoch,
        );
        let data = launch::data_dir(&self.dir, &ticket.plugin_id);
        let started = match server::spawn(&ticket.spec, &ticket.root, &data, ticket.log) {
            Ok(spawned) => {
                match self
                    .lock()
                    .server_mut(&ticket.plugin_id, &ticket.server_id, epoch)
                {
                    Some(ls) => ls.starting = Some(spawned.stopper()),
                    // Stopped while spawning.
                    None => return spawned.stop(),
                }
                server::connect(spawned, STARTUP_DEADLINE, move |reason| {
                    if let Some(host) = host.upgrade() {
                        host.exited(&plugin_id, &server_id, epoch, reason);
                    }
                })
                .await
            }
            Err(failure) => Err(failure),
        };
        let stale = {
            let mut inner = self.lock();
            match inner.server_mut(&ticket.plugin_id, &ticket.server_id, epoch) {
                None => started
                    .ok()
                    .map(|server| (ticket.server_id.clone(), server)),
                Some(ls) => {
                    ls.starting = None;
                    let stale = match started {
                        // An exit that landed before this point already set `exited`.
                        Ok(server) if ls.entry.status == Status::Starting => {
                            ls.entry.status = Status::Running;
                            ls.running = Some(server);
                            None
                        }
                        Ok(server) => Some((ticket.server_id.clone(), server)),
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
        self.stop(Stopping {
            running: stale.into_iter().collect(),
            starting: Vec::new(),
        })
        .await;
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
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::test_support::{
        eventually, fixture_copy, gone, host_at, hung_child, require_python, running,
        server_logged_a_cancel, set_mode, slow_call, temp_dir,
    };
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn disabling_a_plugin_cancels_its_calls_before_the_server_stops() {
        require_python();
        let host = running("yui-test").await;
        let call = slow_call(&host, "pet-a", "c1");
        tokio::time::sleep(Duration::from_millis(300)).await;
        host.disable("yui-test").await.unwrap();
        let ended = tokio::time::timeout(Duration::from_secs(1), call).await;
        assert_eq!(
            ended.unwrap().unwrap(),
            Err("plugin tool cancelled".to_string())
        );
        assert!(
            eventually(|| server_logged_a_cancel(&host)).await,
            "{:?}",
            host.log_tail("yui-test")
        );
    }

    #[tokio::test]
    async fn shutdown_stops_a_server_still_starting_and_kills_its_tree() {
        require_python();
        let (host, _) = host_at(&temp_dir());
        let folder = fixture_copy("yui-test");
        set_mode(&folder, "hang");
        host.add(folder).unwrap();
        let enabling = tokio::spawn({
            let host = host.clone();
            async move { host.enable("yui-test").await }
        });
        assert!(eventually(|| hung_child(&host, "yui-test").is_some()).await);
        host.shutdown().await;
        let pid = hung_child(&host, "yui-test").unwrap();
        let killed = eventually(|| gone(pid)).await;
        let ended = tokio::time::timeout(Duration::from_secs(5), enabling).await;
        assert!(killed, "sleep {pid} still runs");
        assert!(ended.is_ok(), "the start did not end");
        let tail = host.log_tail("yui-test").unwrap();
        assert!(tail.iter().any(|l| l == "[main] stopped"), "{tail:?}");
        assert!(
            !tail.iter().any(|l| l.starts_with("[main] failed")),
            "{tail:?}"
        );
    }

    #[tokio::test]
    async fn one_hanging_plugin_does_not_hold_back_another_at_app_start() {
        require_python();
        let app_data = temp_dir();
        let (hanging, other) = (fixture_copy("yui-a"), fixture_copy("yui-b"));
        set_mode(&hanging, "hang");
        let stored = |id: &str, path: &PathBuf, seq: u64| {
            json!({"id": id, "source": "local", "path": path, "enabled": true,
                "approvedPath": path, "enabledSeq": seq})
        };
        std::fs::create_dir_all(app_data.join("plugins")).unwrap();
        std::fs::write(
            app_data.join("plugins/state.json"),
            json!({"plugins": [stored("yui-a", &hanging, 0), stored("yui-b", &other, 1)],
                "nextSeq": 2})
            .to_string(),
        )
        .unwrap();
        let (host, _) = host_at(&app_data);
        let starting = tokio::spawn({
            let host = host.clone();
            async move { host.start_enabled().await }
        });
        let status = |id: &str| {
            let snapshot = host.snapshot();
            snapshot
                .plugins
                .iter()
                .find(|p| p.id == id)
                .unwrap()
                .servers[0]
                .status
        };
        let other_ran = eventually(|| status("yui-b") == Status::Running).await;
        let hanging_status = status("yui-a");
        host.shutdown().await;
        starting.abort();
        assert!(other_ran, "yui-b: {:?}", status("yui-b"));
        assert_eq!(hanging_status, Status::Starting);
    }
}
