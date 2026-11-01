//! Terminals: shells YUI runs in PTYs, shown in the Threads window's Terminal tab and reached by
//! the backend's terminal tools. A preset reads or writes a terminal only with the user's Allow.

pub mod commands;
mod input;
mod pty;
mod screen;
mod store;

use std::sync::Arc;
use std::time::Duration;
use tauri::{App, AppHandle, Emitter, Manager, RunEvent};

/// How long a tool call waits for the user's Allow.
const ALLOW_LIMIT: Duration = Duration::from_secs(60);

pub fn setup(app: &App) {
    let handle = app.handle().clone();
    app.manage(Arc::new(pty::Store::new(ALLOW_LIMIT, move |snapshot| {
        if let Err(error) = handle.emit("terminal-snapshot", snapshot) {
            log::warn!("terminal_snapshot_emit_failed error={error}");
        }
    })));
}

/// Kills every terminal before the app exits.
pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    if !matches!(event, RunEvent::Exit) {
        return;
    }
    if let Some(store) = app.try_state::<Arc<pty::Store>>() {
        let ptys: Vec<_> = store
            .snapshot()
            .terminals
            .iter()
            .filter_map(|terminal| store.close(&terminal.id, None).ok())
            .collect();
        pty::kill_all(&ptys.iter().map(|pty| pty.as_ref()).collect::<Vec<_>>());
        // Dropping the last handles closes the PTYs; on Windows that ends their consoles' clients.
    }
}
