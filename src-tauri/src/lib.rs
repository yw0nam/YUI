// OS event watcher — real OS polling for active app, idle, fullscreen, camera.
mod os_event_watcher;

// Drag + multi-monitor / DPI.
#[cfg(desktop)]
mod drag;

// Screen-source enumeration and capture.
#[cfg(desktop)]
mod screenshot;

// Image resize and JPEG data-URL encode.
#[cfg(desktop)]
mod image_encode;

// Calendar-date-based log rotation.
mod log_rotation;

// Turn-record JSONL append command — speak-rate/suppression analysis source.
mod turn_log;

// Shared import filesystem helpers (sanitize/collision).
mod import_fs;

// Bring-your-own-VRM import (file copy into app-data).
mod vrm_import;

// Bring-your-own-voice import (reference clip copy into app-data).
mod voice_import;

// Card import (JSON, PNG or preset file parse, thumbnail copy, preset photo pick).
mod card_import;

// The files last dropped onto each settings window.
mod dropped_files;

// Preset file (.yui) read/write, VRM license rule, PNG card chunk.
mod preset_file;

// Click-through toggle (top-level + Windows child HWNDs).
#[cfg(desktop)]
mod passthrough;

// Runs local plugins' MCP servers and answers their tool calls and skill reads.
#[cfg(desktop)]
mod mcp_host;

// PTY terminals the user and the backend share.
#[cfg(desktop)]
mod terminal;

// Loopback HTTP ingress — receives signals, re-emits as Tauri events.
mod agent_ingress;
mod threads;

// System tray controls for window visibility, settings, and quit.
#[cfg(desktop)]
mod tray;

// Lifts AppKit's frame-constrain-to-screen on the pet window (macOS only).
mod window_frame;

// A docked window's native child link to its owner window (macOS only).
#[cfg(desktop)]
mod window_dock;

// The Threads window's native number and its no-focus order-front.
#[cfg(desktop)]
mod threads_window;

// App log sink, timezone and line format.
mod app_log;

// Plugin registration.
mod plugins;

// Startup work run once the app is built.
mod setup;

// IPC command table.
mod commands;

pub fn run() {
    plugins::register(tauri::Builder::default())
        .setup(setup::run)
        .invoke_handler(commands::handler())
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            mcp_host::on_window_event(_window, _event);
            #[cfg(desktop)]
            dropped_files::on_window_event(_window, _event);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(desktop)]
            mcp_host::on_run_event(_app, &_event);
            #[cfg(desktop)]
            terminal::on_run_event(_app, &_event);
        });
}
