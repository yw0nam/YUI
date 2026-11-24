//! Which herdr servers to watch: local and every enabled saved machine.

use crate::cli;
use crate::parse;
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
    let machines = cli::run(&bin, &["machine", "list", "--json"])
        .await
        .map_err(|e| format!("machine list: {}", one_line(&e)))
        .and_then(|text| parse::machine_rows(&text).map_err(|e| format!("machine list: {e}")));
    let machines = match machines {
        Ok(machines) => machines,
        Err(e) => {
            eprintln!("herdr_watch_failed machine=local error={e}");
            return out;
        }
    };
    for m in machines.into_iter().filter(|m| m.enabled) {
        out.push(Watched {
            machine: m.id,
            label: m.label,
            endpoint: Endpoint::Remote {
                target: m.target,
                session: m.session,
            },
        });
    }
    out
}

#[cfg(all(test, unix))]
mod tests {
    use super::remote_socket;

    #[test]
    fn a_sessions_socket_follows_the_saved_session() {
        assert_eq!(
            remote_socket("/home/u", "default"),
            "/home/u/.config/herdr/herdr.sock"
        );
        assert_eq!(
            remote_socket("/home/u", "work"),
            "/home/u/.config/herdr/sessions/work/herdr.sock"
        );
    }
}
