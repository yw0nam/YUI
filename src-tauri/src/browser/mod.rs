//! The `browser` client tool's native half: a dedicated Chrome the app owns, driven over CDP.

mod args;
mod gate;
mod keys;
mod lifecycle;
mod outcome;
mod relay;
mod script;
mod session;
mod shell;
mod shots;
mod snapshot;

pub use shell::BrowserShell;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn browser_generation(shell: State<'_, BrowserShell>) -> u64 {
    shell.generation()
}

/// Starts a new generation and cancels the call in flight; never waits on it.
#[tauri::command]
pub fn browser_cancel(shell: State<'_, BrowserShell>) -> u64 {
    shell.cancel()
}

#[tauri::command]
pub async fn browser_run(
    app: AppHandle,
    gen: u64,
    deadline_at: u64,
    action: String,
    args: serde_json::Value,
) -> String {
    app.state::<BrowserShell>()
        .run(gen, deadline_at, &action, &args)
        .await
}

#[tauri::command]
pub async fn browser_stop(app: AppHandle) {
    app.state::<BrowserShell>().stop().await;
}

/// Stops the owned browser before the app exits.
pub fn stop_on_exit(app: &AppHandle) {
    tauri::async_runtime::block_on(app.state::<BrowserShell>().stop());
}
