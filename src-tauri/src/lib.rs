// OS event watcher — real OS polling for active app, idle, fullscreen, camera.
mod os_event_watcher;

// Drag + multi-monitor / DPI.
#[cfg(desktop)]
mod drag;

// Screen-source enumeration and capture.
#[cfg(desktop)]
mod screenshot;

// Calendar-date-based log rotation.
mod log_rotation;

// Turn-record JSONL append command — speak-rate/suppression analysis source.
mod turn_log;

// Shared import filesystem helpers (sanitize/collision).
mod import_fs;

// Bring-your-own-VRM import (file copy into app-data).
mod vrm_import;

// Stage background image import (file copy into app-data).
mod stage_image;

// Bring-your-own-voice import (reference clip copy into app-data).
mod voice_import;

// Click-through toggle (top-level + Windows child HWNDs).
#[cfg(desktop)]
mod passthrough;

// Loopback HTTP ingress — receives agent lifecycle signals, re-emits as Tauri events.
mod agent_ingress;

// System tray controls for window visibility, settings, and quit.
#[cfg(desktop)]
mod tray;

// Lifts AppKit's frame-constrain-to-screen on the pet window (macOS only).
mod window_frame;

// App log sink, timezone and line format.
mod app_log;

// Plugin registration.
mod plugins;

// Startup work run once the app is built.
mod setup;

// IPC command table.
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    plugins::register(tauri::Builder::default())
        .setup(setup::run)
        .invoke_handler(commands::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
