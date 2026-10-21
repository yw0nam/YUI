//! Screen-source enumeration and capture (native half).
//!
//! # Responsibilities
//! - `list_screen_sources` command: enumerate displays via `xcap::Monitor::all()`.
//! - `capture_screen` command: async; runs the blocking display grab + encode off
//!   the main thread via `spawn_blocking` so the UI never freezes per capture.
//! - Resize and JPEG encode run in `crate::image_encode`.

use crate::image_encode::encode_capture;
use serde::{Deserialize, Serialize};
use tauri::command;
use xcap::image::{ImageBuffer, Rgba};

// ─── Serialisable DTOs ────────────────────────────────────────────────────────

/// One available display source returned to the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSourceDto {
    /// Enumeration index (0-based, matches `capture_screen` `index` param).
    pub index: u32,
    /// Platform display name (may be `None`).
    pub name: Option<String>,
    /// Physical pixel width.
    pub width: u32,
    /// Physical pixel height.
    pub height: u32,
    /// Whether this is the primary display.
    pub is_primary: bool,
}

/// Captured JPEG image returned to the webview as a data URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDto {
    /// `data:image/jpeg;base64,<...>` string.
    pub data_url: String,
}

fn build_screen_source<E: std::fmt::Display>(
    index: u32,
    name: Result<String, E>,
    width: Result<u32, E>,
    height: Result<u32, E>,
    is_primary: Result<bool, E>,
) -> ScreenSourceDto {
    if name.is_err() || width.is_err() || height.is_err() || is_primary.is_err() {
        log::warn!("monitor_metadata_unavailable index={index}");
    }

    ScreenSourceDto {
        index,
        name: name.ok(),
        width: width.unwrap_or(0),
        height: height.unwrap_or(0),
        is_primary: is_primary.unwrap_or(false),
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Logs a finished capture with the monitor id xcap reports and the captured size.
fn log_screen_captured(monitor: &xcap::Monitor, raw: &ImageBuffer<Rgba<u8>, Vec<u8>>) {
    log::debug!(
        "{}",
        screen_captured_line(monitor.id().ok(), raw.width(), raw.height())
    );
}

fn screen_captured_line(monitor_id: Option<u32>, width: u32, height: u32) -> String {
    let monitor = monitor_id.map_or_else(|| "unknown".to_string(), |id| id.to_string());
    format!("screen_captured monitor={monitor} width={width} height={height}")
}

/// Return info for all available displays.
///
/// The enumeration order is stable within a single process lifetime and is used
/// as the `index` passed to `capture_screen`.
#[command]
pub fn list_screen_sources() -> Result<Vec<ScreenSourceDto>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| {
        log::error!("monitor_enumeration_failed error={e}");
        e.to_string()
    })?;
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            build_screen_source(i as u32, m.name(), m.width(), m.height(), m.is_primary())
        })
        .collect())
}

/// Capture display at `index` and return a JPEG data URL with long edge ≤ `max_edge`.
///
/// Runs the blocking grab + encode off the main thread so the UI never freezes.
/// `max_edge == 0` skips resize entirely.
#[command]
pub async fn capture_screen(index: u32, max_edge: u32) -> Result<CaptureDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let monitors = xcap::Monitor::all().map_err(|e| {
            log::error!("monitor_enumeration_failed error={e}");
            e.to_string()
        })?;
        let monitor = monitors
            .into_iter()
            .nth(index as usize)
            .ok_or_else(|| format!("monitor index {index} out of range"))?;

        let raw: ImageBuffer<Rgba<u8>, Vec<u8>> = monitor.capture_image().map_err(|e| {
            log::error!("screen_capture_failed monitor={index} error={e}");
            e.to_string()
        })?;
        log_screen_captured(&monitor, &raw);

        encode_capture(raw, max_edge).map(|data_url| CaptureDto { data_url })
    })
    .await
    .map_err(|e| {
        log::error!("capture_screen_join_failed error={e}");
        e.to_string()
    })?
}

/// Capture the display containing a logical desktop point off the main thread.
#[command]
pub async fn capture_screen_at(x: i32, y: i32, max_edge: u32) -> Result<CaptureDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let monitor = xcap::Monitor::from_point(x, y).map_err(|e| {
            log::error!("monitor_lookup_failed x={x} y={y} error={e}");
            e.to_string()
        })?;
        let raw = monitor.capture_image().map_err(|e| {
            log::error!("screen_capture_failed x={x} y={y} error={e}");
            e.to_string()
        })?;
        log_screen_captured(&monitor, &raw);
        encode_capture(raw, max_edge).map(|data_url| CaptureDto { data_url })
    })
    .await
    .map_err(|e| {
        log::error!("capture_screen_join_failed error={e}");
        e.to_string()
    })?
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── screen_captured_line ──

    #[test]
    fn screen_captured_line_names_the_monitor_id_or_unknown() {
        assert_eq!(
            screen_captured_line(Some(69732928), 3024, 1964),
            "screen_captured monitor=69732928 width=3024 height=1964"
        );
        assert_eq!(
            screen_captured_line(None, 800, 600),
            "screen_captured monitor=unknown width=800 height=600"
        );
    }

    // ── build_screen_source ──

    #[test]
    fn build_screen_source_preserves_available_metadata() {
        let dto = build_screen_source(
            3,
            Result::<_, &str>::Ok("Studio Display".to_string()),
            Result::<_, &str>::Ok(5120),
            Result::<_, &str>::Ok(2880),
            Result::<_, &str>::Ok(true),
        );

        assert_eq!(dto.index, 3);
        assert_eq!(dto.name.as_deref(), Some("Studio Display"));
        assert_eq!(dto.width, 5120);
        assert_eq!(dto.height, 2880);
        assert!(dto.is_primary);
    }

    #[test]
    fn build_screen_source_preserves_index_with_unavailable_metadata() {
        let dto =
            build_screen_source::<&str>(4, Err("boom"), Err("boom"), Err("boom"), Err("boom"));

        assert_eq!(dto.index, 4);
        assert_eq!(dto.name, None);
        assert_eq!(dto.width, 0);
        assert_eq!(dto.height, 0);
        assert!(!dto.is_primary);
    }

    // ── CaptureDto serialisation ──────────────────────────────────────────────

    #[test]
    fn capture_dto_serialises_camel_case() {
        let dto = CaptureDto {
            data_url: "data:image/png;base64,abc".to_string(),
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["dataUrl"], "data:image/png;base64,abc");
    }

    // ── ScreenSourceDto serialisation ─────────────────────────────────────────

    #[test]
    fn screen_source_dto_serialises_camel_case() {
        let dto = ScreenSourceDto {
            index: 0,
            name: Some("Built-in Retina Display".to_string()),
            width: 2560,
            height: 1600,
            is_primary: true,
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["index"], 0);
        assert_eq!(v["name"], "Built-in Retina Display");
        assert_eq!(v["width"], 2560);
        assert_eq!(v["height"], 1600);
        assert_eq!(v["isPrimary"], true);
    }
}
