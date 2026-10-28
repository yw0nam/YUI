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

// Tavern card import/export (file parse, thumbnail copy, exported file write).
mod card_import;

// Click-through toggle (top-level + Windows child HWNDs).
#[cfg(desktop)]
mod passthrough;

// Relays browser scripts to the installed ego lite CLI.
#[cfg(desktop)]
mod browser;

// Runs local plugins' MCP servers and answers their tool calls and skill reads.
#[cfg(desktop)]
mod mcp_host;

// Loopback HTTP ingress — receives signals, re-emits as Tauri events.
mod agent_ingress;

// System tray controls for window visibility, settings, and quit.
#[cfg(desktop)]
mod tray;

// Lifts AppKit's frame-constrain-to-screen on the pet window (macOS only).
mod window_frame;

// The quick-card window's native child link to its pet window (macOS only).
#[cfg(desktop)]
mod quick_card_dock;

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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {});
}
