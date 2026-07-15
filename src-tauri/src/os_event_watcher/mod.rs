//! OS event watcher — Tauri main(Rust) side OS API access.
//!
//! Polls active app, window title, OS-wide idle, and fullscreen state, then
//! emits `os_event` IPC events to the webview.
//!
//! Platform support:
//!   macOS  — fully implemented (NSWorkspace, CGEventSource, CGWindowList)
//!   Windows — fully implemented (GetForegroundWindow, GetLastInputInfo, EnumWindows)
//!   Android — cfg-gated no-op degrade
//!   other  — idle-source error emitted, no panic

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter};

pub const OS_EVENT_CHANNEL: &str = "os_event";

/// Channel for the drag-drop release signal emitted after `start_dragging()`.
#[allow(dead_code)] // consumed by platform drop-release probes; dead on unsupported targets
pub const WINDOW_DROP_RELEASE_CHANNEL: &str = "window_drop_release";

/// `os_event` channel payload — "Rust → Webview" handoff.
#[derive(Debug, Clone, Serialize)]
pub struct OsEventPayload {
    /// "active_app_changed" | "fullscreen_entered"
    /// | "fullscreen_exited" | "os_idle_tick"
    pub event_name: String,
    /// client epoch ms
    pub ts: i64,
    pub data: OsEventData,
}

/// `data` block — all fields optional; each event_name populates different fields.
#[derive(Debug, Clone, Default, Serialize)]
pub struct OsEventData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_fullscreen: Option<bool>,
    /// OS-wide idle (ms). macOS `CGEventSourceSecondsSinceLastEventType`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_idle_ms: Option<u64>,
}

/// Returns current epoch milliseconds.
pub fn epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Converts idle seconds (f64) to milliseconds (u64), clamping negative to 0.
#[allow(dead_code)] // used by the macOS watcher; dead on other targets
pub fn idle_ms_from_secs(secs: f64) -> u64 {
    if secs < 0.0 {
        0
    } else {
        (secs * 1000.0) as u64
    }
}

/// Sanitises a raw OS app name: trims whitespace, returns None if empty.
#[allow(dead_code)] // used by the macOS watcher; dead on other targets
pub fn sanitise_app_name(raw: &str) -> Option<String> {
    let s = raw.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Sanitises a raw window title: trims, returns None if empty.
#[allow(dead_code)] // used by the macOS watcher; dead on other targets
pub fn sanitise_window_title(raw: &str) -> Option<String> {
    let s = raw.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Emits one OS event to the webview (fire-and-forget).
pub fn emit_os_event(app: &AppHandle, payload: OsEventPayload) -> tauri::Result<()> {
    let result = app.emit(OS_EVENT_CHANNEL, payload);
    if let Err(e) = &result {
        log::warn!("os_event_emit_failed error={e}");
    }
    result
}

// ─── Window-sit drop: release signal + window list ───────────────────────────

/// One on-screen window, all measurements in points (top-left origin).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowAtPoint {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub name: Option<String>,
    pub pid: i32,
    /// Stable CoreGraphics window identity (`kCGWindowNumber`).
    pub window_number: u32,
}

/// Lists every foreign on-screen window in front-to-back (topmost first) order,
/// each in logical points (top-left origin).
///
/// Excludes YUI's own pid and platform chrome (menu bar / Dock / wallpaper on
/// macOS; taskbar / desktop on Windows). The frontend uses the full list for
/// the perch top-edge catch zone, whose U-band lies outside the window bounds
/// and so cannot be resolved by a point-in-rect hit-test. Platforms without an
/// enumeration implementation return `Ok(Vec::new())`.
#[command]
pub fn list_windows() -> Result<Vec<WindowAtPoint>, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(macos::list_all_windows())
    }
    #[cfg(target_os = "windows")]
    {
        Ok(windows::list_all_windows())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(Vec::new())
    }
}

// ─── Platform-specific OS polling ────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

// Drop-release probe, invoked by drag.rs after start_dragging().
// Emits `window_drop_release` as a bare signal (no payload).
#[cfg(target_os = "macos")]
pub use macos::spawn_drop_release_probe;

#[cfg(target_os = "windows")]
pub use windows::spawn_drop_release_probe;

// ─── start() — spawns background polling loop ─────────────────────────────────

/// Starts the OS event polling loop as a background thread.
/// Called once from Tauri `setup`.
#[allow(unused_variables)]
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::start_polling(app.clone());

    #[cfg(target_os = "windows")]
    windows::start_polling(app.clone());

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Unsupported platform: emit one idle-source-error tick so the webview
        // knows the source is in error state (degraded recovery).
        let app = app.clone();
        std::thread::spawn(move || {
            // Emit a single error indicator and then exit — no panic.
            let _ = emit_os_event(
                &app,
                OsEventPayload {
                    event_name: "os_idle_tick".into(),
                    ts: epoch_ms(),
                    data: OsEventData {
                        os_idle_ms: None,
                        ..Default::default()
                    },
                },
            );
        });
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── existing contract tests (must stay green) ────────────────────────────

    #[test]
    fn channel_name_is_stable() {
        assert_eq!(OS_EVENT_CHANNEL, "os_event");
    }

    #[test]
    fn data_skips_none_fields() {
        let v = serde_json::to_value(OsEventData::default()).unwrap();
        assert_eq!(v, json!({}));
    }

    #[test]
    fn payload_shape_matches_ipc_contract() {
        let payload = OsEventPayload {
            event_name: "os_idle_tick".into(),
            ts: 123,
            data: OsEventData {
                os_idle_ms: Some(5000),
                ..Default::default()
            },
        };
        let v = serde_json::to_value(payload).unwrap();
        assert_eq!(
            v,
            json!({ "event_name": "os_idle_tick", "ts": 123, "data": { "os_idle_ms": 5000 } })
        );
    }

    // ── idle_ms_from_secs ────────────────────────────────────────────────────

    #[test]
    fn idle_ms_rounds_fractional_seconds() {
        // 1.5s → 1500ms
        assert_eq!(idle_ms_from_secs(1.5), 1500);
    }

    #[test]
    fn idle_ms_clamps_negative_to_zero() {
        // negative idle is nonsensical — clamp to 0
        assert_eq!(idle_ms_from_secs(-1.0), 0);
    }

    #[test]
    fn idle_ms_zero() {
        assert_eq!(idle_ms_from_secs(0.0), 0);
    }

    #[test]
    fn idle_ms_large_value() {
        // 3600s = 1h → 3_600_000ms
        assert_eq!(idle_ms_from_secs(3600.0), 3_600_000);
    }

    // ── sanitise_app_name ───────────────────────────────────────────────────

    #[test]
    fn sanitise_app_name_trims_whitespace() {
        assert_eq!(sanitise_app_name("  Finder  "), Some("Finder".into()));
    }

    #[test]
    fn sanitise_app_name_empty_returns_none() {
        assert_eq!(sanitise_app_name(""), None);
        assert_eq!(sanitise_app_name("   "), None);
    }

    #[test]
    fn sanitise_app_name_normal() {
        assert_eq!(sanitise_app_name("Safari"), Some("Safari".into()));
    }

    // ── sanitise_window_title ───────────────────────────────────────────────

    #[test]
    fn sanitise_window_title_trims_and_preserves() {
        assert_eq!(
            sanitise_window_title("  My Document.pdf  "),
            Some("My Document.pdf".into())
        );
    }

    #[test]
    fn sanitise_window_title_empty_returns_none() {
        assert_eq!(sanitise_window_title(""), None);
    }

    // ── payload shape — active_app_changed ──────────────────────────────────

    #[test]
    fn active_app_changed_payload_shape() {
        let p = OsEventPayload {
            event_name: "active_app_changed".into(),
            ts: 1000,
            data: OsEventData {
                active_app_name: Some("Finder".into()),
                active_window_title: Some("Desktop".into()),
                ..Default::default()
            },
        };
        let v = serde_json::to_value(p).unwrap();
        assert_eq!(v["event_name"], "active_app_changed");
        assert_eq!(v["data"]["active_app_name"], "Finder");
        assert_eq!(v["data"]["active_window_title"], "Desktop");
        assert!(
            v["data"]["os_idle_ms"].is_null()
                || !v["data"].as_object().unwrap().contains_key("os_idle_ms")
        );
    }

    #[test]
    fn fullscreen_entered_payload_shape() {
        let p = OsEventPayload {
            event_name: "fullscreen_entered".into(),
            ts: 2000,
            data: OsEventData {
                is_fullscreen: Some(true),
                ..Default::default()
            },
        };
        let v = serde_json::to_value(p).unwrap();
        assert_eq!(v["event_name"], "fullscreen_entered");
        assert_eq!(v["data"]["is_fullscreen"], true);
    }

    #[test]
    fn fullscreen_exited_payload_shape() {
        let p = OsEventPayload {
            event_name: "fullscreen_exited".into(),
            ts: 3000,
            data: OsEventData {
                is_fullscreen: Some(false),
                ..Default::default()
            },
        };
        let v = serde_json::to_value(p).unwrap();
        assert_eq!(v["event_name"], "fullscreen_exited");
        assert_eq!(v["data"]["is_fullscreen"], false);
    }

    // ── fullscreen state machine ─────────────────────────────────────────────

    #[test]
    fn fullscreen_state_toggles_correctly() {
        // Simulate what the polling loop does: track previous state
        let mut was_fullscreen = false;
        let events: Vec<&str> = [false, false, true, true, false]
            .iter()
            .filter_map(|&fs| {
                if fs != was_fullscreen {
                    let name = if fs {
                        "fullscreen_entered"
                    } else {
                        "fullscreen_exited"
                    };
                    was_fullscreen = fs;
                    Some(name)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(events, vec!["fullscreen_entered", "fullscreen_exited"]);
    }

    // ── active app change detection ──────────────────────────────────────────

    #[test]
    fn app_change_detected_on_name_differ() {
        let prev: Option<String> = Some("Finder".into());
        let next: Option<String> = Some("Safari".into());
        assert!(prev != next, "name change should be detected");
    }

    #[test]
    fn app_change_not_emitted_when_same() {
        let prev: Option<String> = Some("Safari".into());
        let next: Option<String> = Some("Safari".into());
        assert!(prev == next, "no change = no emit");
    }

    #[test]
    fn app_change_detected_from_none_to_some() {
        let prev: Option<String> = None;
        let next: Option<String> = Some("Finder".into());
        assert!(prev != next);
    }

    // ── epoch_ms sanity ──────────────────────────────────────────────────────

    #[test]
    fn epoch_ms_is_positive() {
        assert!(epoch_ms() > 0);
    }

    #[test]
    fn epoch_ms_is_reasonable_year() {
        // Must be after 2024-01-01 epoch ms = 1_704_067_200_000
        assert!(epoch_ms() > 1_704_067_200_000);
    }

    // ── WindowAtPoint serialisation ──────────────────────────────────────────

    #[test]
    fn window_at_point_serialises_camel_case() {
        let w = WindowAtPoint {
            x: 100.0,
            y: 200.0,
            width: 800.0,
            height: 600.0,
            name: Some("Safari".into()),
            pid: 4321,
            window_number: 8765,
        };
        let v = serde_json::to_value(&w).unwrap();
        assert_eq!(v["x"], 100.0);
        assert_eq!(v["y"], 200.0);
        assert_eq!(v["width"], 800.0);
        assert_eq!(v["height"], 600.0);
        assert_eq!(v["name"], "Safari");
        assert_eq!(v["pid"], 4321);
        assert_eq!(v["windowNumber"], 8765);
    }

    #[test]
    fn window_at_point_serialises_null_name() {
        let w = WindowAtPoint {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
            name: None,
            pid: 1,
            window_number: 42,
        };
        let v = serde_json::to_value(&w).unwrap();
        assert!(v["name"].is_null());
        assert_eq!(v["windowNumber"], 42);
    }
}
