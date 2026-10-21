//! The `browser` client tool's native half: relays scripts to the installed ego lite CLI.

mod locate;
mod relay;
mod script;
mod shots;

pub use relay::Relay;
use relay::{RunOutcome, LIMITS, NOT_FOUND};
pub use shots::sweep_stale;
use tauri::State;

#[tauri::command]
pub async fn browser_run(
    relay: State<'_, Relay>,
    space: String,
    code: String,
) -> Result<RunOutcome, String> {
    let bin = locate::find_ego_browser().ok_or(NOT_FOUND)?;
    relay.run(&bin, &space, &code, LIMITS).await
}

#[tauri::command]
pub async fn browser_guide(relay: State<'_, Relay>) -> Result<String, String> {
    let bin = locate::find_ego_browser().ok_or(NOT_FOUND)?;
    relay.guide(&bin, LIMITS.kill_after).await
}
