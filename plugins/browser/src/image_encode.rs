//! Image resize and base64 JPEG encode for screenshots.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageBuffer, Rgba};

/// JPEG quality used when encoding images (0–100).
const JPEG_QUALITY: u8 = 72;

/// The media type of what `encode_capture` returns.
pub const MIME: &str = "image/jpeg";

/// Scales `(width, height)` down to a long edge of `max_edge` (0: unchanged), never to a 0 side.
pub fn fit_long_edge(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    if max_edge == 0 || (width <= max_edge && height <= max_edge) {
        return (width, height);
    }
    let scale = max_edge as f64 / width.max(height) as f64;
    let w = ((width as f64 * scale).round() as u32).max(1);
    let h = ((height as f64 * scale).round() as u32).max(1);
    (w, h)
}

/// Resizes `raw` to a long edge of at most `max_edge` (0: no resize) and returns it as base64 JPEG.
pub fn encode_capture(
    raw: ImageBuffer<Rgba<u8>, Vec<u8>>,
    max_edge: u32,
) -> Result<String, String> {
    let src_w = raw.width();
    let src_h = raw.height();
    let (dst_w, dst_h) = fit_long_edge(src_w, src_h, max_edge);

    let final_img: ImageBuffer<Rgba<u8>, Vec<u8>> = if (dst_w, dst_h) == (src_w, src_h) {
        raw
    } else {
        image::imageops::resize(&raw, dst_w, dst_h, image::imageops::FilterType::Lanczos3)
    };

    let rgb = DynamicImage::ImageRgba8(final_img).to_rgb8();

    let mut jpeg_bytes: Vec<u8> = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg_bytes, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| {
            eprintln!("jpeg_encoding_failed error={e}");
            e.to_string()
        })?;

    Ok(B64.encode(&jpeg_bytes))
}

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

    /// The base64 JPEG, decoded.
    fn decoded(b64: &str) -> image::RgbImage {
        image::load_from_memory(&B64.decode(b64).unwrap())
            .unwrap()
            .to_rgb8()
    }

    /// Whether every pixel is the source colour, within JPEG loss.
    fn is_source_colour(img: &image::RgbImage) -> bool {
        img.pixels()
            .all(|p| (0..3).all(|c| p.0[c].abs_diff([10, 20, 30][c]) <= 4))
    }

    #[test]
    fn encode_capture_no_resize_preserves_dimensions() {
        let raw = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(4, 4, Rgba([10, 20, 30, 255]));
        let img = decoded(&encode_capture(raw, 0).unwrap());
        assert_eq!(img.dimensions(), (4, 4));
        assert!(is_source_colour(&img));
    }

    #[test]
    fn encode_capture_downscales_to_fit_long_edge() {
        let raw = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(8, 4, Rgba([10, 20, 30, 255]));
        let img = decoded(&encode_capture(raw, 2).unwrap());
        assert_eq!(img.dimensions(), fit_long_edge(8, 4, 2));
        assert_eq!(img.dimensions(), (2, 1));
        assert!(is_source_colour(&img));
    }

    #[test]
    fn encode_capture_payload_decodes_non_empty() {
        let raw = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(4, 4, Rgba([10, 20, 30, 255]));
        let b64 = encode_capture(raw, 0).unwrap();
        let bytes = B64.decode(b64).unwrap();
        assert!(!bytes.is_empty());
    }
}
