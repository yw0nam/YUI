//! Image resize and base64 JPEG encode for screenshots.

#[allow(unused_imports)]
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use image::{ImageBuffer, Rgba};

pub fn fit_long_edge(_width: u32, _height: u32, _max_edge: u32) -> (u32, u32) {
    (0, 0)
}

pub fn encode_capture(
    _raw: ImageBuffer<Rgba<u8>, Vec<u8>>,
    _max_edge: u32,
) -> Result<String, String> {
    Ok(String::new())
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
