//! Drag + multi-monitor / DPI support.
//!
//! # Responsibilities
//! - `drag_window` command: called from webview `pointerdown` to initiate OS-native window drag.
//! - `get_monitors_info` command: returns all monitors with DPI-safe fields for the webview to
//!   compute logical/physical conversions when needed.
//! - Pure DPI math helpers (unit-tested without Tauri runtime): `physical_to_logical`,
//!   `logical_to_physical`, `clamp_to_work_area`.
//!
//! # Multi-monitor / DPI correctness
//! Tauri v2 `Window::start_dragging()` is OS-native and moves the window in *physical* pixels
//! internally. The OS DWM / Quartz Compositor handles the physical-to-logical remapping when
//! the window crosses a monitor boundary; we do NOT need to manually reposition after a drag.
//!
//! The `onScaleChanged` JS listener (see `src/drag.ts`) is the seam for reacting to DPI changes
//! (e.g., snapping or re-centering).
//!
//! # Dispatcher seam
//! Click/pet-gesture events on the character region belong to the dispatcher. `src/drag.ts` emits
//! a placeholder `"__yui_gesture_stub"` custom event at the drag-start site as the gesture seam.

use serde::Serialize;
use tauri::{command, AppHandle, Manager, Runtime, WebviewWindow};

// ─── Serialisable monitor descriptor ────────────────────────────────────────

/// Monitor information returned to the webview.
///
/// All size / position values are in **physical pixels** (matching Tauri's
/// `Monitor::size()` / `Monitor::position()` semantics). `scale_factor` maps
/// physical → logical: `logical = physical / scale_factor`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Human-readable name (may be `None` on some platforms).
    pub name: Option<String>,
    /// Physical width in pixels.
    pub width_px: u32,
    /// Physical height in pixels.
    pub height_px: u32,
    /// Physical X offset of the top-left corner (may be negative on multi-monitor).
    pub x_px: i32,
    /// Physical Y offset of the top-left corner.
    pub y_px: i32,
    /// Scale factor (physical / logical). 1.0 = 100% DPI, 2.0 = 200% (Retina etc.).
    pub scale_factor: f64,
}

/// Work area of a monitor in **logical pixels / points** (Dock/menu-bar excluded).
///
/// Matches the perch coordinate chain, which operates in points. `scale_factor`
/// is the source monitor's DPI multiplier, carried through for callers needing it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkAreaInfo {
    /// Logical X of the work-area top-left corner (may be negative on multi-monitor).
    pub x: f64,
    /// Logical Y of the work-area top-left corner.
    pub y: f64,
    /// Logical work-area width.
    pub width: f64,
    /// Logical work-area height.
    pub height: f64,
    /// Scale factor (physical / logical) of the source monitor.
    pub scale_factor: f64,
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// Start OS-native window drag.
///
/// Called from the webview on `pointerdown` inside the drag region. Uses
/// `WebviewWindow::start_dragging` which delegates to the OS window manager —
/// no manual position tracking needed.
///
/// Returns `Ok(())` on success; the window follows the pointer until the
/// primary mouse button is released, then stays at the new position.
#[command]
pub fn drag_window<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    window.start_dragging().map_err(|e| {
        log::warn!("start_dragging failed: {e}");
        e.to_string()
    })?;

    // Detect the drop release and emit `window_drop_release` with the cursor
    // point. The poll thread is needed because the OS-modal drag loop does not
    // surface a release to the webview.
    #[cfg(target_os = "macos")]
    crate::os_event_watcher::spawn_drop_release_probe(window.app_handle().clone());

    Ok(())
}

/// Return info for all available monitors.
///
/// The webview uses this to understand the physical/logical pixel mapping on
/// each screen so it can make correct decisions if manual repositioning is ever
/// needed (e.g., centering on a target monitor). For the drag path itself this
/// is informational only — the OS handles DPI-correct placement.
#[command]
pub fn get_monitors_info<R: Runtime>(app: AppHandle<R>) -> Result<Vec<MonitorInfo>, String> {
    // Grab any window to call `available_monitors()` on it.
    let window = app.get_webview_window("main").ok_or_else(|| {
        log::warn!("get_monitors_info: main window not found");
        "main window not found".to_string()
    })?;
    let monitors = window.available_monitors().map_err(|e| {
        log::warn!("available_monitors failed: {e}");
        e.to_string()
    })?;
    Ok(monitors
        .into_iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned(),
            width_px: m.size().width,
            height_px: m.size().height,
            x_px: m.position().x,
            y_px: m.position().y,
            scale_factor: m.scale_factor(),
        })
        .collect())
}

/// Return the work area (Dock/menu-bar excluded) of the monitor the pet window
/// currently sits on, in **logical pixels / points**.
///
/// Anchors on `current_monitor()` (the window's display) rather than enumerating
/// all monitors, so the JS fall sequence computes the correct on-screen bottom on
/// the active display. The physical work-area rect is converted to points here to
/// match the perch coordinate chain.
#[command]
pub fn get_work_area_for_window<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<WorkAreaInfo, String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| {
            log::warn!("current_monitor failed: {e}");
            e.to_string()
        })?
        .ok_or_else(|| {
            log::warn!("get_work_area_for_window: no current monitor");
            "no current monitor".to_string()
        })?;
    let area = monitor.work_area();
    Ok(work_area_to_logical(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        monitor.scale_factor(),
    ))
}

// ─── Pure DPI math helpers (no Tauri runtime dependency) ────────────────────
//
// These are the canonical functions for physical ↔ logical pixel conversion.
// All callers (Rust or TS via IPC) should use these semantics so that the
// formula is tested in one place.

/// Convert a physical-pixel coordinate to a logical pixel coordinate.
///
/// `scale_factor` is the monitor's reported DPI multiplier (e.g., 2.0 for
/// Retina displays). Returns `None` if `scale_factor` ≤ 0.
pub fn physical_to_logical(physical: i64, scale_factor: f64) -> Option<f64> {
    if scale_factor <= 0.0 {
        return None;
    }
    Some(physical as f64 / scale_factor)
}

/// Convert a logical-pixel coordinate to a physical pixel coordinate.
///
/// Returns `None` if `scale_factor` ≤ 0.
pub fn logical_to_physical(logical: f64, scale_factor: f64) -> Option<i64> {
    if scale_factor <= 0.0 {
        return None;
    }
    Some((logical * scale_factor).round() as i64)
}

/// Clamp a logical position `(x, y)` so that the window `(w × h)` stays within
/// the monitor's logical work area `(wx, wy, ww, wh)`.
///
/// All arguments are in **logical pixels**. Returns the clamped `(x, y)`.
pub fn clamp_to_work_area(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    work_x: f64,
    work_y: f64,
    work_w: f64,
    work_h: f64,
) -> (f64, f64) {
    let clamped_x = x.max(work_x).min(work_x + work_w - w);
    let clamped_y = y.max(work_y).min(work_y + work_h - h);
    (clamped_x, clamped_y)
}

/// Convert a monitor's physical-pixel work-area rect into logical points.
///
/// `(x, y)` is the work-area top-left (physical, may be negative on multi-monitor);
/// `(width, height)` its physical size. Output is logical px / points, matching the
/// perch coordinate chain. Uses `physical_to_logical`, falling back to the raw value
/// only if `scale_factor` ≤ 0 (which `physical_to_logical` rejects).
pub fn work_area_to_logical(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
) -> WorkAreaInfo {
    let to_logical = |physical: i64| physical_to_logical(physical, scale_factor).unwrap_or(physical as f64);
    WorkAreaInfo {
        x: to_logical(x as i64),
        y: to_logical(y as i64),
        width: to_logical(width as i64),
        height: to_logical(height as i64),
        scale_factor,
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── physical_to_logical ──────────────────────────────────────────────────

    #[test]
    fn physical_to_logical_1x() {
        assert_eq!(physical_to_logical(1920, 1.0), Some(1920.0));
    }

    #[test]
    fn physical_to_logical_2x_retina() {
        assert_eq!(physical_to_logical(2880, 2.0), Some(1440.0));
    }

    #[test]
    fn physical_to_logical_1_5x_windows_hiDPI() {
        let result = physical_to_logical(2400, 1.5).unwrap();
        assert!((result - 1600.0).abs() < 1e-9);
    }

    #[test]
    fn physical_to_logical_rejects_zero_scale() {
        assert_eq!(physical_to_logical(100, 0.0), None);
    }

    #[test]
    fn physical_to_logical_rejects_negative_scale() {
        assert_eq!(physical_to_logical(100, -1.0), None);
    }

    // ── logical_to_physical ──────────────────────────────────────────────────

    #[test]
    fn logical_to_physical_1x() {
        assert_eq!(logical_to_physical(600.0, 1.0), Some(600));
    }

    #[test]
    fn logical_to_physical_2x_retina() {
        assert_eq!(logical_to_physical(600.0, 2.0), Some(1200));
    }

    #[test]
    fn logical_to_physical_rounds() {
        assert_eq!(logical_to_physical(100.3, 2.0), Some(201));
    }

    #[test]
    fn logical_to_physical_rejects_zero_scale() {
        assert_eq!(logical_to_physical(100.0, 0.0), None);
    }

    #[test]
    fn logical_to_physical_rejects_negative_scale() {
        assert_eq!(logical_to_physical(100.0, -2.0), None);
    }

    // ── round-trip ───────────────────────────────────────────────────────────

    #[test]
    fn round_trip_physical_logical_physical_2x() {
        let physical = 1240i64;
        let logical = physical_to_logical(physical, 2.0).unwrap();
        let back = logical_to_physical(logical, 2.0).unwrap();
        assert_eq!(back, physical);
    }

    #[test]
    fn round_trip_physical_logical_physical_1_5x() {
        let physical = 300i64;
        let logical = physical_to_logical(physical, 1.5).unwrap();
        let back = logical_to_physical(logical, 1.5).unwrap();
        assert_eq!(back, physical);
    }

    // ── clamp_to_work_area ───────────────────────────────────────────────────

    #[test]
    fn clamp_noop_when_inside() {
        let (cx, cy) = clamp_to_work_area(100.0, 100.0, 400.0, 600.0, 0.0, 0.0, 2560.0, 1440.0);
        assert!((cx - 100.0).abs() < 1e-9);
        assert!((cy - 100.0).abs() < 1e-9);
    }

    #[test]
    fn clamp_left_edge() {
        let (cx, _) = clamp_to_work_area(-50.0, 100.0, 400.0, 600.0, 0.0, 0.0, 2560.0, 1440.0);
        assert!((cx - 0.0).abs() < 1e-9);
    }

    #[test]
    fn clamp_right_edge() {
        let (cx, _) =
            clamp_to_work_area(2400.0, 100.0, 400.0, 600.0, 0.0, 0.0, 2560.0, 1440.0);
        assert!((cx - 2160.0).abs() < 1e-9);
    }

    #[test]
    fn clamp_top_edge() {
        let (_, cy) = clamp_to_work_area(100.0, -10.0, 400.0, 600.0, 0.0, 0.0, 2560.0, 1440.0);
        assert!((cy - 0.0).abs() < 1e-9);
    }

    #[test]
    fn clamp_bottom_edge() {
        let (_, cy) =
            clamp_to_work_area(100.0, 1000.0, 400.0, 600.0, 0.0, 0.0, 2560.0, 1440.0);
        assert!((cy - 840.0).abs() < 1e-9);
    }

    #[test]
    fn clamp_respects_non_zero_work_origin() {
        let (cx, cy) =
            clamp_to_work_area(1800.0, 50.0, 400.0, 600.0, 1920.0, 0.0, 1920.0, 1080.0);
        assert!((cx - 1920.0).abs() < 1e-9);
        assert!((cy - 50.0).abs() < 1e-9);
    }

    // ── work_area_to_logical ──────────────────────────────────────────────────

    #[test]
    fn work_area_to_logical_1x_primary() {
        let info = work_area_to_logical(0, 25, 2560, 1415, 1.0);
        assert!((info.x - 0.0).abs() < 1e-9);
        assert!((info.y - 25.0).abs() < 1e-9);
        assert!((info.width - 2560.0).abs() < 1e-9);
        assert!((info.height - 1415.0).abs() < 1e-9);
        assert!((info.scale_factor - 1.0).abs() < 1e-9);
    }

    #[test]
    fn work_area_to_logical_2x_retina() {
        // Retina: physical px halve into logical points.
        let info = work_area_to_logical(0, 50, 2880, 1700, 2.0);
        assert!((info.x - 0.0).abs() < 1e-9);
        assert!((info.y - 25.0).abs() < 1e-9);
        assert!((info.width - 1440.0).abs() < 1e-9);
        assert!((info.height - 850.0).abs() < 1e-9);
        assert!((info.scale_factor - 2.0).abs() < 1e-9);
    }

    #[test]
    fn work_area_to_logical_negative_origin_secondary_display() {
        // Secondary monitor to the left of primary: negative physical X origin.
        let info = work_area_to_logical(-1920, 0, 1920, 1080, 1.0);
        assert!((info.x - -1920.0).abs() < 1e-9);
        assert!((info.y - 0.0).abs() < 1e-9);
        assert!((info.width - 1920.0).abs() < 1e-9);
        assert!((info.height - 1080.0).abs() < 1e-9);
    }

    #[test]
    fn work_area_to_logical_negative_origin_with_2x_scale() {
        // Negative-origin secondary display at 2x: offset and size both halve.
        let info = work_area_to_logical(-2880, -100, 2880, 1800, 2.0);
        assert!((info.x - -1440.0).abs() < 1e-9);
        assert!((info.y - -50.0).abs() < 1e-9);
        assert!((info.width - 1440.0).abs() < 1e-9);
        assert!((info.height - 900.0).abs() < 1e-9);
    }

    #[test]
    fn work_area_to_logical_serialises_camel_case() {
        let info = work_area_to_logical(0, 25, 1920, 1055, 1.0);
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["x"], 0.0);
        assert_eq!(v["y"], 25.0);
        assert_eq!(v["width"], 1920.0);
        assert_eq!(v["height"], 1055.0);
        assert_eq!(v["scaleFactor"], 1.0);
    }

    // ── MonitorInfo serialisation ─────────────────────────────────────────────

    #[test]
    fn monitor_info_serialises_camel_case() {
        let m = MonitorInfo {
            name: Some("Built-in Display".to_string()),
            width_px: 2560,
            height_px: 1600,
            x_px: 0,
            y_px: 0,
            scale_factor: 2.0,
        };
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["widthPx"], 2560);
        assert_eq!(v["heightPx"], 1600);
        assert_eq!(v["scaleFactor"], 2.0);
        assert_eq!(v["xPx"], 0);
        assert_eq!(v["yPx"], 0);
        assert_eq!(v["name"], "Built-in Display");
    }

    #[test]
    fn monitor_info_serialises_null_name() {
        let m = MonitorInfo {
            name: None,
            width_px: 1920,
            height_px: 1080,
            x_px: 0,
            y_px: 0,
            scale_factor: 1.0,
        };
        let v = serde_json::to_value(&m).unwrap();
        assert!(v["name"].is_null());
    }
}
