//! Image resize and base64 JPEG encode for screenshots.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageBuffer, Rgba};

/// JPEG quality used when encoding images (0–100).
const JPEG_QUALITY: u8 = 72;

/// The media type of what `encode_capture` returns.
pub const MIME: &str = "image/jpeg";

/// Scales `(width, height)` down to a long edge of `max_edge` (0: unchanged), never to a 0 side.
fn fit_long_edge(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
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

    #[test]
    fn encode_capture_fits_the_long_edge_and_keeps_the_colour() {
        let cases = [
            ((4, 4), 4, (4, 4)),
            ((4, 3), 8, (4, 3)),
            ((8, 4), 2, (2, 1)),
            ((4, 8), 2, (1, 2)),
            ((6, 4), 0, (6, 4)),
            ((1, 100), 10, (1, 10)),
        ];
        for ((w, h), max_edge, size) in cases {
            let raw = ImageBuffer::from_pixel(w, h, Rgba([10, 20, 30, 255]));
            let jpeg = B64.decode(encode_capture(raw, max_edge).unwrap()).unwrap();
            let img = image::load_from_memory(&jpeg).unwrap().to_rgb8();
            assert_eq!(img.dimensions(), size, "{w}x{h} at {max_edge}");
            let near = |p: &image::Rgb<u8>| (0..3).all(|c| p.0[c].abs_diff([10, 20, 30][c]) <= 4);
            assert!(img.pixels().all(near), "colour of {w}x{h} at {max_edge}");
        }
    }
}
