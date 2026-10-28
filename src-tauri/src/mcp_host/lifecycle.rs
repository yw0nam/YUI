//! Server starts and stops: tickets tagged with an epoch, start results, exits, and stops.

use super::host::{Host, Inner};
use super::manifest::ServerSpec;
use super::server::{self, PluginLog, Server};
use super::snapshot::{ServerEntry, Status};
use std::path::PathBuf;
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
}

impl LiveServer {
    pub fn new(plugin_id: &str, spec: &ServerSpec) -> Self {
        Self {
            spec: spec.clone(),
            entry: ServerEntry {
                id: format!("{plugin_id}/{}", spec.name),
                name: spec.name.clone(),
                status: Status::Stopped,
                phase: None,
                reason: None,
            },
            epoch: 0,
            running: None,
        }
    }
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

    /// Marks the matching servers as stopped and hands back the running ones.
    pub fn stop_servers(&mut self, which: impl Fn(&str, &LiveServer) -> bool) -> Vec<Server> {
        let mut stopping = Vec::new();
        for (plugin_id, live) in &mut self.live {
            for ls in live.servers.iter_mut().filter(|ls| which(plugin_id, ls)) {
                self.next_epoch += 1;
                ls.epoch = self.next_epoch;
                ls.entry.reset(Status::Stopped);
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

impl Host {
    /// Runs the tickets one after another.
    pub(super) async fn start(self: &Arc<Self>, tickets: Vec<Ticket>) {
        for ticket in tickets {
            self.run(ticket).await;
        }
    }

    pub(super) async fn stop(&self, stopping: Vec<Server>) {
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
        let data = self.dir.join("data").join(&ticket.plugin_id);
        let started = match server::spawn(&ticket.spec, &ticket.root, &data, ticket.log) {
            Ok(spawned) => {
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
        self.stop(stale.into_iter().collect()).await;
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
