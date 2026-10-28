//! The host's Tauri commands; each forwards to `Host`.

use super::catalog::CatalogEntry;
use super::host::Host;
use super::snapshot::Snapshot;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn plugin_host_snapshot(host: State<'_, Arc<Host>>) -> Snapshot {
    host.snapshot()
}

/// Opens the folder picker here, so the webview never names a path. `None` when dismissed.
#[tauri::command]
pub async fn plugin_host_add_local(
    app: AppHandle,
    host: State<'_, Arc<Host>>,
) -> Result<Option<String>, String> {
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|e| e.to_string())?;
    let Some(folder) = picked else {
        return Ok(None);
    };
    host.add(folder.into_path().map_err(|e| e.to_string())?)
        .map(Some)
}

#[tauri::command]
pub async fn plugin_host_enable(
    host: State<'_, Arc<Host>>,
    plugin_id: String,
) -> Result<(), String> {
    host.enable(&plugin_id).await
}

#[tauri::command]
pub async fn plugin_host_disable(
    host: State<'_, Arc<Host>>,
    plugin_id: String,
) -> Result<(), String> {
    host.disable(&plugin_id).await
}

#[tauri::command]
pub async fn plugin_host_retry(
    host: State<'_, Arc<Host>>,
    server_id: String,
) -> Result<(), String> {
    host.retry(&server_id).await
}

#[tauri::command]
pub fn plugin_host_log_tail(
    host: State<'_, Arc<Host>>,
    plugin_id: String,
) -> Result<Vec<String>, String> {
    host.log_tail(&plugin_id)
}

#[tauri::command]
pub async fn plugin_host_catalog(host: State<'_, Arc<Host>>) -> Result<Vec<CatalogEntry>, String> {
    host.catalog().await
}

#[tauri::command]
pub async fn plugin_host_install(
    host: State<'_, Arc<Host>>,
    plugin_id: String,
) -> Result<(), String> {
    host.install(&plugin_id).await
}

#[tauri::command]
pub async fn plugin_host_remove(
    host: State<'_, Arc<Host>>,
    plugin_id: String,
) -> Result<(), String> {
    host.remove(&plugin_id).await
}

#[tauri::command]
pub async fn plugin_host_call(
    window: WebviewWindow,
    host: State<'_, Arc<Host>>,
    call_id: String,
    name: String,
    arguments: Value,
    preset_id: String,
) -> Result<Value, String> {
    host.call(window.label(), &call_id, &name, arguments, &preset_id)
        .await
}

#[tauri::command]
pub fn plugin_host_cancel(window: WebviewWindow, host: State<'_, Arc<Host>>, call_id: String) {
    host.cancel(window.label(), &call_id);
}

#[tauri::command]
pub fn plugin_host_skill(host: State<'_, Arc<Host>>, name: String) -> Result<String, String> {
    host.skill(&name)
}
