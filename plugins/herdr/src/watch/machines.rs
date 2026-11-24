//! Which herdr servers to watch: local and every enabled saved machine.

use crate::cli;
use crate::watch::one_line;
use std::path::PathBuf;

pub struct Watched {
    pub machine: String,
    pub label: String,
    pub endpoint: Endpoint,
}

pub enum Endpoint {
    Local(PathBuf),
    Remote { target: String, session: String },
}

/// The local CLI's socket: `HERDR_SOCKET_PATH` when set, else the default session's.
pub fn local_socket() -> PathBuf {
    if let Some(p) = std::env::var_os("HERDR_SOCKET_PATH") {
        return PathBuf::from(p);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".config").join("herdr").join("herdr.sock")
}

/// A session's socket on a remote machine, under its home.
pub fn remote_socket(home: &str, session: &str) -> String {
    if session == "default" {
        format!("{home}/.config/herdr/herdr.sock")
    } else {
        format!("{home}/.config/herdr/sessions/{session}/herdr.sock")
    }
}

/// The machine list is read once; a machine added later waits for the next server start.
pub async fn watched(locate: fn() -> Option<PathBuf>) -> Vec<Watched> {
    let mut out = vec![Watched {
        machine: "local".into(),
        label: "local".into(),
        endpoint: Endpoint::Local(local_socket()),
    }];
    let Some(bin) = locate() else {
        return out;
    };
    let text = match cli::run(&bin, &["machine", "list", "--json"]).await {
        Ok(text) => text,
        Err(e) => {
            eprintln!(
                "herdr_watch_failed machine=local reason=machine list: {}",
                one_line(&e)
            );
            return out;
        }
    };
    let machines = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.as_array().cloned());
    let Some(machines) = machines else {
        eprintln!("herdr_watch_failed machine=local reason=machine list parse: not a JSON array");
        return out;
    };
    for m in &machines {
        if m.get("enabled").and_then(serde_json::Value::as_bool) != Some(true) {
            continue;
        }
        let s = |k: &str| m.get(k).and_then(serde_json::Value::as_str).unwrap_or("");
        let id = s("id");
        if id.is_empty() {
            continue;
        }
        let session = if s("session").is_empty() {
            "default"
        } else {
            s("session")
        };
        out.push(Watched {
            machine: id.to_string(),
            label: s("label").to_string(),
            endpoint: Endpoint::Remote {
                target: s("target").to_string(),
                session: session.to_string(),
            },
        });
    }
    out
}
