use super::pty::{self, Store};
use super::store::{AccessKind, TerminalOwner, TerminalSnapshot};
use crate::os_event_watcher::epoch_ms;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

type Terminals<'a> = State<'a, Arc<Store>>;

fn now() -> u64 {
    epoch_ms() as u64
}

/// Runs a tool call that may wait for the user's Allow off the main thread; an error is its result.
async fn waiting(
    app: AppHandle,
    call: impl FnOnce(&Store) -> Result<String, String> + Send + 'static,
) -> String {
    let store = app.state::<Arc<Store>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || call(&store).unwrap_or_else(|error| error))
        .await
        .unwrap_or_else(|error| format!("error: {error}"))
}

#[tauri::command]
pub fn terminal_snapshot(store: Terminals<'_>) -> TerminalSnapshot {
    store.snapshot()
}

#[tauri::command]
pub fn terminal_open(store: Terminals<'_>, cwd: Option<String>) -> Result<String, String> {
    pty::open(&store, TerminalOwner::User, cwd.as_deref(), now()).map(|t| t.id)
}

#[tauri::command]
pub fn terminal_close(store: Terminals<'_>, id: String) -> Result<(), String> {
    store.close(&id, None)?.kill();
    Ok(())
}

#[tauri::command]
pub fn terminal_input(store: Terminals<'_>, id: String, data: String) -> Result<(), String> {
    store.get(&id)?.write(data.as_bytes())
}

#[tauri::command]
pub fn terminal_resize(store: Terminals<'_>, cols: u16, rows: u16) {
    store.set_size(cols, rows);
    for pty in store.all() {
        pty.resize(cols, rows);
    }
}

#[tauri::command]
pub fn terminal_attach(
    store: Terminals<'_>,
    id: String,
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    store.get(&id)?.attach(on_output);
    Ok(())
}

#[tauri::command]
pub fn terminal_answer(
    store: Terminals<'_>,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    store.answer(&request_id, allow)
}

#[tauri::command]
pub fn terminal_take_back(store: Terminals<'_>, id: String) -> Result<(), String> {
    store.take_back(&id)
}

#[tauri::command]
pub fn terminal_tool_open(store: Terminals<'_>, preset_id: String, cwd: Option<String>) -> String {
    match pty::open(
        &store,
        TerminalOwner::Preset { preset_id },
        cwd.as_deref(),
        now(),
    ) {
        Ok(terminal) => format!("opened {} ({})", terminal.id, terminal.title),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn terminal_tool_list(store: Terminals<'_>) -> String {
    let terminals = store.snapshot().terminals;
    if terminals.is_empty() {
        return "no terminals".into();
    }
    terminals
        .iter()
        .map(|t| {
            let owner = match &t.owner {
                TerminalOwner::User => "you",
                TerminalOwner::Preset { preset_id } => preset_id,
            };
            let access = t.access.as_deref().unwrap_or("none");
            format!(
                "{} | {owner} | {} | {} | access: {access}",
                t.id,
                t.title,
                t.status()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub async fn terminal_tool_read(
    app: AppHandle,
    call_id: String,
    preset_id: String,
    id: String,
    lines: Option<u32>,
) -> String {
    waiting(app, move |store| {
        let (pty, terminal) =
            store.gate(&call_id, &preset_id, &id, AccessKind::Read, None, now())?;
        Ok(pty.read(&terminal, lines))
    })
    .await
}

#[tauri::command]
pub async fn terminal_tool_write(
    app: AppHandle,
    call_id: String,
    preset_id: String,
    id: String,
    text: String,
    enter: Option<bool>,
) -> String {
    waiting(app, move |store| {
        let (pty, _) = store.gate(
            &call_id,
            &preset_id,
            &id,
            AccessKind::Write,
            Some(&text),
            now(),
        )?;
        let enter = if enter.unwrap_or(true) { "\r" } else { "" };
        pty.write(format!("{text}{enter}").as_bytes())?;
        Ok("ok".into())
    })
    .await
}

#[tauri::command]
pub fn terminal_tool_close(store: Terminals<'_>, preset_id: String, id: String) -> String {
    match store.close(&id, Some(&preset_id)) {
        Ok(pty) => {
            pty.kill();
            format!("closed {id}")
        }
        Err(error) => error,
    }
}

#[tauri::command]
pub fn terminal_tool_cancel(store: Terminals<'_>, call_id: String) {
    store.cancel(&call_id);
}
