//! The MCP host: installs Catalog plugins, runs the MCP servers of local and Catalog plugins as
//! YUI-hosted servers, and answers the webview's tool calls and skill reads.
//!
//! - **State.** `<app_data>/plugins/state.json` lists each plugin's id, folder, enablement,
//!   the folder the user consented to, and the order plugins were enabled in. It is written to
//!   `state.json.tmp` and renamed over the file. A file that is not JSON moves to
//!   `state.json.bad` and the host starts empty; a file that cannot be read lists nothing and
//!   every managing command fails, so stored enablement is never overwritten. Without an app
//!   data dir the host behaves the same way.
//! - **Consent.** A plugin runs only when it is enabled and its folder is the one consented to;
//!   enabling consents to the current folder. An official update moves a held consent to the new
//!   folder; a community update clears it, so the user is asked again.
//! - **Catalog.** The Catalog is fetched from `plugins/catalog.json` on main; a verify build reads
//!   `YUI_PLUGIN_CATALOG_URL` instead. Install downloads this platform's release zip, checks its
//!   sha256 (the catalog's for an official plugin, the release's `checksums.txt` for a community
//!   one), and unpacks it into `<app_data>/plugins/installed/<id>/<version>/` after checking the
//!   plugin id and version it holds. An update prepares the new folder, switches and saves the
//!   stored path, then stops the old servers, then deletes the old folder and starts the servers
//!   again when consent holds; while the old servers stop, enable and retry of that plugin are
//!   refused.
//!   Remove stops the servers, unlists the plugin, and deletes `<app_data>/plugins/data/<id>/`
//!   and, for a Catalog plugin, `installed/<id>/`; a local plugin's folder and the logs stay.
//! - **Servers.** Each `.mcp.json` server is spawned without a shell, in the plugin folder, with
//!   `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` (`<app_data>/plugins/data/<id>/`)
//!   expanded, in its own process group (a job object on Windows). Spawn, `initialize` and
//!   `tools/list` share a 30 s deadline; a failure names the phase. A server that ends by itself
//!   shows `exited` and is not restarted; retry or the next app start runs it again.
//! - **Logs.** stderr lines, at most 2000 bytes each, and lifecycle lines go to
//!   `<log dir>/plugins/<id>_YYYY-MM-DD.log` and to a tail of the last 20 lines.
//! - **Snapshot.** Every change emits `plugin-host-snapshot` to every window with a revision one
//!   higher, starting from 0 at app start. A built-in client tool, then the plugin enabled
//!   first, keeps a tool name; the plugin enabled first keeps a skill name. A later plugin's
//!   colliding name is left out of its declared lists and calls and recorded in its `hidden`.
//! - **Calls.** A call carries the window's preset in `_meta` and ends at the tool's `wait_ms`
//!   (30 s by default, 120 s at most), when its window cancels it or is destroyed, or when its
//!   server stops; each sends `notifications/cancelled`. A window cannot reuse the id of its
//!   call still in flight.
//! - **Stop.** Disable, retry and app exit cancel the server's calls, close its connection,
//!   give it 1 s to exit, then kill its process tree. On unix a server still starting has its
//!   process group killed at once. On Windows a tree ends when the host drops its job object:
//!   at the end of a stop, when the start of a server stopped while starting ends (at the
//!   latest at the 30 s deadline), or when the app process exits. At app start each enabled
//!   plugin starts as its own task.

mod calls;
mod catalog;
pub mod commands;
mod host;
mod install;
mod launch;
mod lifecycle;
mod manifest;
mod orphans;
mod server;
mod snapshot;
mod store;
#[cfg(all(test, unix))]
mod test_support;

use host::Host;
use std::path::Path;
use std::sync::Arc;
use tauri::{App, AppHandle, Emitter, Manager, RunEvent, Window, WindowEvent};
use time::UtcOffset;

const SNAPSHOT_EVENT: &str = "plugin-host-snapshot";

/// Manages the host and starts every enabled plugin whose consent holds.
pub fn setup(app: &App, log_dir: &Path, offset: UtcOffset) {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string());
    if let Err(e) = &app_data {
        log::error!("mcp_host_app_data_dir_unavailable error={e}");
    }
    let handle = app.handle().clone();
    let catalog = catalog::Config::production();
    let host = Host::new(app_data, log_dir, offset, catalog, move |snapshot| {
        if let Err(e) = handle.emit(SNAPSHOT_EVENT, snapshot) {
            log::warn!("mcp_host_emit_failed error={e}");
        }
    });
    app.manage(host.clone());
    tauri::async_runtime::spawn(async move { host.start_enabled().await });
}

/// Cancels the calls of a window when it is destroyed.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    if let Some(host) = window.try_state::<Arc<Host>>() {
        host.cancel_window(window.label());
    }
}

/// Stops every server before the app exits.
pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    if !matches!(event, RunEvent::Exit) {
        return;
    }
    if let Some(host) = app.try_state::<Arc<Host>>() {
        tauri::async_runtime::block_on(host.shutdown());
    }
}
