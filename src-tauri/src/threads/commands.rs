use super::store::{ThreadStore, ThreadsSnapshot};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn threads_snapshot(store: State<'_, Arc<ThreadStore>>) -> ThreadsSnapshot {
    store.snapshot()
}

#[tauri::command]
pub fn thread_read(store: State<'_, Arc<ThreadStore>>, id: String) -> Result<(), String> {
    store.read(&id).map_err(str::to_owned)
}
