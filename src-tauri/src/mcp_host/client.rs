//! The host's MCP client handler: a server's signals notification becomes a signals payload.

use super::host::Host;
use super::server::PluginLog;
use crate::agent_ingress::payload::SignalsPayload;
use rmcp::handler::client::ClientHandler;
use std::sync::{Arc, Weak};

pub type SignalsSink = Arc<dyn Fn(SignalsPayload) + Send + Sync>;

pub struct HostClient {
    pub(super) plugin_id: String,
    /// The server's name, as the plugin log prefixes its lines.
    pub(super) server: String,
    pub(super) server_id: String,
    pub(super) epoch: u64,
    pub(super) log: Arc<PluginLog>,
    pub(super) host: Weak<Host>,
    pub(super) signals: SignalsSink,
}

impl ClientHandler for HostClient {}

#[cfg(all(test, unix))]
mod tests {
    use super::super::test_support::{
        eventually, fixture_copy, host_sinks, no_catalog, require_python, temp_dir, Signals,
    };
    use super::*;
    use serde_json::{json, Value};

    async fn signalled() -> (Arc<Host>, Signals) {
        let (host, _, signals) = host_sinks(&temp_dir(), no_catalog());
        host.add(fixture_copy("yui-test")).unwrap();
        host.enable("yui-test").await.unwrap();
        (host, signals)
    }

    async fn notify(host: &Host, call_id: &str, params: Value) {
        let sent = host
            .call(
                "pet-a",
                call_id,
                "notify",
                json!({ "params": params }),
                "preset-1",
            )
            .await;
        assert_eq!(sent.unwrap()["content"][0]["text"], json!("\"sent\""));
    }

    #[tokio::test]
    async fn a_signals_notification_reaches_the_sink_with_the_plugin_id() {
        require_python();
        let (host, signals) = signalled().await;
        let envelope = json!({"source": "fixture", "event_type": "ping", "delivery": "urgent",
            "event_id": "n-1", "occurred_at": 1});
        notify(
            &host,
            "c1",
            json!({"signals": [{"kind": "ping"}], "envelope": envelope}),
        )
        .await;
        assert!(eventually(|| signals.lock().unwrap().len() == 1).await);
        host.shutdown().await;
        let received = signals.lock().unwrap();
        let payload = &received[0];
        assert_eq!(received.len(), 1);
        assert_eq!(payload.plugin.as_deref(), Some("yui-test"));
        assert_eq!(payload.signals, vec![json!({"kind": "ping"})]);
        assert_eq!(payload.envelope, envelope);
        assert!(payload.ts > 0);
    }

    #[tokio::test]
    async fn a_refused_notification_is_a_plugin_log_line_and_never_reaches_the_sink() {
        require_python();
        let (host, signals) = signalled().await;
        notify(&host, "c1", json!({"signals": [{"kind": "ping"}]})).await;
        notify(
            &host,
            "c2",
            json!({"signals": [{"s": "x".repeat(16 * 1024)}], "envelope": {"event_id": "n-2"}}),
        )
        .await;
        let refused = [
            "[main] signals refused: the envelope is missing or null",
            "[main] signals refused: a signal item is over 16384 bytes",
        ];
        let logged = || {
            let tail = host.log_tail("yui-test").unwrap();
            refused.iter().all(|line| tail.iter().any(|l| l == line))
        };
        let all_logged = eventually(logged).await;
        let tail = host.log_tail("yui-test").unwrap();
        host.shutdown().await;
        assert!(all_logged, "tail: {tail:?}");
        assert!(signals.lock().unwrap().is_empty());
    }
}
