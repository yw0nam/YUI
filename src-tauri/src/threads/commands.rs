use super::model::AnswerInput;
use super::store::{ThreadStore, ThreadsSnapshot};
use crate::os_event_watcher::epoch_ms;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn threads_snapshot(store: State<'_, Arc<ThreadStore>>) -> ThreadsSnapshot {
    store.snapshot()
}

#[tauri::command]
pub fn thread_answer(
    store: State<'_, Arc<ThreadStore>>,
    id: String,
    ask_id: String,
    choice: Option<String>,
    text: Option<String>,
    release: Option<bool>,
) -> Result<(), String> {
    store
        .answer(
            &id,
            AnswerInput {
                ask_id,
                choice,
                text,
                release,
            },
            epoch_ms() as u64,
        )
        .map_err(|e| e.0.to_owned())
}
