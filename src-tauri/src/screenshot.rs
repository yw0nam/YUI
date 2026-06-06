//! Screen-source enumeration and capture — issue #20 Stage 2 (native half).
//!
//! # Responsibilities
//! - `list_screen_sources` command: enumerate displays via `xcap::Monitor::all()`.
//! - `capture_screen` command: capture a display by enumeration index, resize to
//!   `max_edge`, encode as PNG data URL.
//! - `fit_long_edge`: pure resize-math helper (unit-tested, no xcap dependency).

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::command;
use xcap::image::{ImageBuffer, ImageFormat, Rgba};

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

/// Captured PNG image returned to the webview as a data URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDto {
    /// `data:image/png;base64,<...>` string.
    pub data_url: String,
    /// Width of the (possibly resized) image in pixels.
    pub width: u32,
    /// Height of the (possibly resized) image in pixels.
    pub height: u32,
}

// ─── Pure resize helper ───────────────────────────────────────────────────────

/// Scale `(width, height)` down so `max(w, h) ≤ max_edge`.
///
/// Returns the pair unchanged when already within bounds or when `max_edge == 0`.
/// Never returns 0 for a non-zero input dimension.
pub fn fit_long_edge(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    if max_edge == 0 || (width <= max_edge && height <= max_edge) {
        return (width, height);
    }
    let scale = max_edge as f64 / width.max(height) as f64;
    let w = ((width as f64 * scale).round() as u32).max(1);
    let h = ((height as f64 * scale).round() as u32).max(1);
    (w, h)
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Return info for all available displays.
///
/// The enumeration order is stable within a single process lifetime and is used
/// as the `index` passed to `capture_screen`.
#[command]
pub fn list_screen_sources() -> Result<Vec<ScreenSourceDto>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| {
        log::error!("monitor enumeration failed: {e}");
        e.to_string()
    })?;
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| ScreenSourceDto {
            index: i as u32,
            name: m.name().ok(),
            width: m.width().unwrap_or(0),
            height: m.height().unwrap_or(0),
            is_primary: m.is_primary().unwrap_or(false),
        })
        .collect())
}

/// Capture display at `index` and return a PNG data URL with long edge ≤ `max_edge`.
///
/// `max_edge == 0` skips resize entirely.
#[command]
pub fn capture_screen(index: u32, max_edge: u32) -> Result<CaptureDto, String> {
    let monitors = xcap::Monitor::all().map_err(|e| {
        log::error!("monitor enumeration failed: {e}");
        e.to_string()
    })?;
    let monitor = monitors
        .into_iter()
        .nth(index as usize)
        .ok_or_else(|| format!("monitor index {index} out of range"))?;

    let raw: ImageBuffer<Rgba<u8>, Vec<u8>> = monitor.capture_image().map_err(|e| {
        log::error!("screen capture failed for monitor {index}: {e}");
        e.to_string()
    })?;

    let src_w = raw.width();
    let src_h = raw.height();
    let (dst_w, dst_h) = fit_long_edge(src_w, src_h, max_edge);

    let final_img: ImageBuffer<Rgba<u8>, Vec<u8>> = if (dst_w, dst_h) == (src_w, src_h) {
        raw
    } else {
        xcap::image::imageops::resize(
            &raw,
            dst_w,
            dst_h,
            xcap::image::imageops::FilterType::Lanczos3,
        )
    };

    let mut png_bytes: Vec<u8> = Vec::new();
    final_img
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            ImageFormat::Png,
        )
        .map_err(|e| {
            log::error!("PNG encoding failed: {e}");
            e.to_string()
        })?;

    let b64 = B64.encode(&png_bytes);
    Ok(CaptureDto {
        data_url: format!("data:image/png;base64,{}", b64),
        width: dst_w,
        height: dst_h,
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── fit_long_edge ─────────────────────────────────────────────────────────

    #[test]
    fn fit_noop_when_within_bounds() {
        assert_eq!(fit_long_edge(1280, 720, 1280), (1280, 720));
    }

    #[test]
    fn fit_noop_when_equal_to_max_edge() {
        assert_eq!(fit_long_edge(800, 600, 800), (800, 600));
    }

    #[test]
    fn fit_noop_when_smaller_than_max_edge() {
        assert_eq!(fit_long_edge(640, 480, 1920), (640, 480));
    }

    #[test]
    fn fit_landscape_downscale() {
        // 3840×2160 → long edge 1280 → 1280×720
        assert_eq!(fit_long_edge(3840, 2160, 1280), (1280, 720));
    }

    #[test]
    fn fit_portrait_downscale() {
        // 2160×3840 → long edge 1080 → 607×1080
        let (w, h) = fit_long_edge(2160, 3840, 1080);
        assert_eq!(h, 1080);
        assert!(w > 0);
    }

    #[test]
    fn fit_square_downscale() {
        assert_eq!(fit_long_edge(2000, 2000, 1000), (1000, 1000));
    }

    #[test]
    fn fit_max_edge_zero_returns_unchanged() {
        assert_eq!(fit_long_edge(3840, 2160, 0), (3840, 2160));
    }

    #[test]
    fn fit_never_returns_zero_width() {
        // Very tall image: 1×10000 → max_edge=1 should produce (1, 1) not (0, 1)
        let (w, _h) = fit_long_edge(1, 10000, 1);
        assert!(w >= 1);
    }

    #[test]
    fn fit_never_returns_zero_height() {
        let (_w, h) = fit_long_edge(10000, 1, 1);
        assert!(h >= 1);
    }

    // ── encode_capture ────────────────────────────────────────────────────────

    #[test]
    fn encode_capture_no_resize_preserves_dimensions() {
        let raw = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(4, 4, Rgba([10, 20, 30, 255]));
        let dto = encode_capture(raw, 0).unwrap();
        assert!(dto.data_url.starts_with("data:image/png;base64,"));
        assert_eq!(dto.width, 4);
        assert_eq!(dto.height, 4);
    }

    #[test]
    fn encode_capture_downscales_to_fit_long_edge() {
        let raw = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(8, 4, Rgba([10, 20, 30, 255]));
        let dto = encode_capture(raw, 2).unwrap();
        assert_eq!((dto.width, dto.height), fit_long_edge(8, 4, 2));
        assert_eq!((dto.width, dto.height), (2, 1));
        assert!(dto.data_url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn encode_capture_payload_decodes_non_empty() {
        let raw = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(4, 4, Rgba([10, 20, 30, 255]));
        let dto = encode_capture(raw, 0).unwrap();
        let b64 = dto.data_url.strip_prefix("data:image/png;base64,").unwrap();
        let bytes = B64.decode(b64).unwrap();
        assert!(!bytes.is_empty());
    }

    // ── CaptureDto serialisation ──────────────────────────────────────────────

    #[test]
    fn capture_dto_serialises_camel_case() {
        let dto = CaptureDto {
            data_url: "data:image/png;base64,abc".to_string(),
            width: 1280,
            height: 720,
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["dataUrl"], "data:image/png;base64,abc");
        assert_eq!(v["width"], 1280);
        assert_eq!(v["height"], 720);
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
