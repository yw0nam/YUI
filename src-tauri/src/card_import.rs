//! Tavern card import and export (native half).
//!
//! Reads a picked `.json` or `.png` card file: JSON passes through; a PNG's card JSON sits
//! in a `ccv3` or `chara` tEXt chunk (base64 of UTF-8 JSON, `ccv3` wins) and the image is
//! copied into `<app_data_dir>/cards/` as the preset's thumbnail. Also retains and removes
//! those files and writes an exported card file.

use std::path::{Path, PathBuf};

/// Max accepted source size for a card JSON.
const MAX_JSON_BYTES: u64 = 16 * 1024 * 1024;

/// Max accepted source size for a card PNG.
const MAX_PNG_BYTES: u64 = 32 * 1024 * 1024;

/// The card JSON inside a PNG's `ccv3`/`chara` tEXt chunks; `ccv3` wins over `chara` regardless
/// of chunk order. The chunk walk is bounds-checked: a truncated length is a malformed PNG.
fn card_json_from_png(_bytes: &[u8]) -> Result<String, String> {
    unimplemented!("png card parse")
}

/// Rename `cards/<temp_id>.png` to `cards/<preset_id>.png` (sanitize_stem on both ids),
/// replacing an existing preset thumbnail, and return the dest path.
fn retain_thumbnail_at(_cards: &Path, _temp_id: &str, _preset_id: &str) -> Result<String, String> {
    unimplemented!("thumbnail retain")
}

/// Delete `cards/<sanitized id>.png` if present. Idempotent — missing is Ok.
fn remove_thumbnail_at(_cards: &Path, _id: &str) -> Result<(), String> {
    unimplemented!("thumbnail remove")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("yui_card_test_{tag}_{}", nanos as u32));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

    /// One PNG chunk with a zero CRC — the walker skips CRCs.
    fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        out.extend_from_slice(&[0, 0, 0, 0]);
        out
    }

    fn card_png(text_chunks: &[(&str, &str)]) -> Vec<u8> {
        let mut png = PNG_SIGNATURE.to_vec();
        for (keyword, text) in text_chunks {
            png.extend(chunk(b"tEXt", format!("{keyword}\0{text}").as_bytes()));
        }
        png.extend(chunk(b"IEND", b""));
        png
    }

    fn b64(json: &str) -> String {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        B64.encode(json)
    }

    #[test]
    fn reads_the_card_json_from_a_chara_chunk() {
        let png = card_png(&[("chara", &b64(r#"{"name":"Mio"}"#))]);
        assert_eq!(card_json_from_png(&png).unwrap(), r#"{"name":"Mio"}"#);
    }

    #[test]
    fn a_late_ccv3_chunk_wins_over_an_earlier_chara_chunk() {
        let png = card_png(&[
            ("chara", &b64(r#"{"name":"V2"}"#)),
            ("ccv3", &b64(r#"{"name":"V3"}"#)),
        ]);
        assert_eq!(card_json_from_png(&png).unwrap(), r#"{"name":"V3"}"#);
    }

    #[test]
    fn a_png_without_a_card_chunk_is_rejected() {
        let png = card_png(&[("Comment", &b64("hello"))]);
        assert_eq!(
            card_json_from_png(&png).unwrap_err(),
            "no card in png".to_string()
        );
    }

    #[test]
    fn a_truncated_chunk_length_is_a_malformed_png() {
        let mut png = PNG_SIGNATURE.to_vec();
        png.extend(chunk(b"tEXt", b"chara\0not json"));
        png.truncate(png.len() - 8); // cut into the chunk's own bytes
        assert_eq!(
            card_json_from_png(&png).unwrap_err(),
            "png malformed".to_string()
        );
    }

    #[test]
    fn an_undecodable_card_payload_is_unreadable() {
        let png = card_png(&[("chara", "!!!not base64!!!")]);
        assert_eq!(
            card_json_from_png(&png).unwrap_err(),
            "card unreadable".to_string()
        );
    }

    #[test]
    fn retain_then_remove_leaves_no_file() {
        let cards = unique_dir("retain_remove");
        std::fs::write(cards.join("temp-1.png"), b"png bytes").unwrap();

        let dest = retain_thumbnail_at(&cards, "temp-1", "abcd1234").unwrap();

        assert_eq!(
            dest,
            cards.join("abcd1234.png").to_string_lossy().into_owned()
        );
        assert!(cards.join("abcd1234.png").exists());
        assert!(!cards.join("temp-1.png").exists());

        remove_thumbnail_at(&cards, "abcd1234").unwrap();
        assert!(!cards.join("abcd1234.png").exists());
        remove_thumbnail_at(&cards, "abcd1234").unwrap(); // idempotent
        std::fs::remove_dir_all(&cards).ok();
    }
}
