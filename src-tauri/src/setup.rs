//! Startup work run once the app is built, before the first window event.

use crate::{app_log, os_event_watcher, tray, turn_log, voice_import, window_frame};
use tauri::{App, Manager};

pub fn run(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Lets the pet window cross onto a lower-scale monitor mid-move instead of
    // being clamped to whichever screen its frame still overlaps.
    if let Some(main) = app.get_webview_window("main") {
        window_frame::allow_unconstrained_frame(&main)?;
    }

    let (log_dir, log_offset) = app_log::init(app)?;
    app.manage(turn_log::TurnRecordLog::new(log_dir, log_offset));

    // Recover any `.{id}.import-tmp` / `.{id}.import-backup` left by a process death
    // mid-import, before the voice picker can read the references dir. Best-effort: an
    // unresolvable app-data dir must not block launch.
    if let Ok(dir) = app.path().app_data_dir() {
        voice_import::sweep_stale_import_artifacts(&dir.join("references"));
    }

    // Start OS event polling loop (emits `os_event` IPC to webview).
    os_event_watcher::start(app.handle());
    tray::setup(app.handle())?;
    // Loopback ingress starts via the `start_agent_ingress` command, invoked
    // once at boot with the user's stored port (restart-to-apply).
    Ok(())
}
