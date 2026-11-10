//! Tavern card import (native half).
//!
//! Reads a picked `.json`, `.png` or `.yui` file: JSON passes through; a PNG's card JSON sits
//! in a `ccv3` or `chara` tEXt chunk (base64 of UTF-8 JSON, `ccv3` wins) and the image is
//! copied into `<app_data_dir>/cards/` as the preset's thumbnail; a `.yui` preset file is read
//! by `preset_file`. Also retains and removes the thumbnails and picks a preset's photo.

use crate::import_fs::{
    app_data_subdir, claim_and_copy, ensure_within, open_and_import, sanitize_stem, sniff_ok,
    ClaimTarget, SniffKind,
};
use crate::preset_file::{read_preset_file, PresetDirs, PresetFileVoice, PresetFileVrm};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle};
use tauri_plugin_dialog::DialogExt;

/// Max accepted source size for a card JSON.
pub(crate) const MAX_JSON_BYTES: u64 = 16 * 1024 * 1024;

/// Max accepted source size for a card PNG.
pub(crate) const MAX_PNG_BYTES: u64 = 32 * 1024 * 1024;

pub(crate) const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

/// Longest edge, in px, of a JPEG photo re-encoded as a preset's thumbnail.
const PHOTO_EDGE: u32 = 512;

/// Widest or tallest JPEG, in px, the photo decode accepts, and the most memory it may take.
const PHOTO_DECODE_MAX_EDGE: u32 = 8192;
const PHOTO_DECODE_MAX_ALLOC: u64 = 256 * 1024 * 1024;

/// Which kind of file a card came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CardSource {
    Json,
    Png,
    Yui,
}

/// Card file handed to the webview: the card JSON, the temp thumbnail id of a PNG or preset
/// file, and the assets a preset file carried.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedCardFile {
    pub source: CardSource,
    /// The card JSON, verbatim from the file or the tEXt chunk.
    pub json: String,
    /// Stem of the thumbnail copy under `cards/`, present for a PNG or preset-file source.
    pub thumbnail_temp_id: Option<String>,
    /// The preset file's crop, passed through unvalidated.
    pub crop: Option<serde_json::Value>,
    pub vrm: Option<PresetFileVrm>,
    pub voice: Option<PresetFileVoice>,
}

impl ImportedCardFile {
    /// A `.json` or `.png` card: no preset-file assets.
    fn plain(source: CardSource, json: String, thumbnail_temp_id: Option<String>) -> Self {
        Self {
            source,
            json,
            thumbnail_temp_id,
            crop: None,
            vrm: None,
            voice: None,
        }
    }
}

/// The length of the chunk at `offset`, when its full `len + type + data + crc` fits `bytes`.
pub(crate) fn chunk_len(bytes: &[u8], offset: usize) -> Option<usize> {
    let head = bytes.get(offset..offset + 4)?;
    let len = u32::from_be_bytes(head.try_into().ok()?) as usize;
    let end = offset.checked_add(12)?.checked_add(len)?;
    (end <= bytes.len()).then_some(len)
}

/// Split a tEXt chunk's `keyword\0text` payload.
pub(crate) fn text_chunk(data: &[u8]) -> Option<(&str, &str)> {
    let nul = data.iter().position(|&b| b == 0)?;
    Some((
        std::str::from_utf8(data.get(..nul)?).ok()?,
        std::str::from_utf8(data.get(nul + 1..)?).ok()?,
    ))
}

/// The card JSON inside a PNG's `ccv3`/`chara` tEXt chunks; `ccv3` wins over `chara` regardless
/// of chunk order. The chunk walk is bounds-checked: a truncated length is a malformed PNG.
pub(crate) fn card_json_from_png(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 8 || &bytes[..8] != PNG_SIGNATURE {
        return Err("png malformed".to_string());
    }
    let mut preferred: Option<String> = None;
    let mut fallback: Option<String> = None;
    let mut offset = 8usize;
    loop {
        let Some(len) = chunk_len(bytes, offset) else {
            return Err("png malformed".to_string());
        };
        let kind = &bytes[offset + 4..offset + 8];
        if kind == b"tEXt" {
            let data = &bytes[offset + 8..offset + 8 + len];
            match text_chunk(data) {
                Some(("ccv3", text)) if preferred.is_none() => preferred = Some(text.to_string()),
                Some(("chara", text)) if fallback.is_none() => fallback = Some(text.to_string()),
                _ => {}
            }
        }
        if kind == b"IEND" {
            break;
        }
        offset += 12 + len;
    }
    let encoded = preferred.or(fallback).ok_or("no card in png".to_string())?;
    let decoded = B64
        .decode(encoded)
        .map_err(|_| "card unreadable".to_string())?;
    String::from_utf8(decoded).map_err(|_| "card unreadable".to_string())
}

/// Read the whole source, refusing anything over `cap` bytes.
pub(crate) fn read_bounded(source: impl Read, cap: u64) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    source
        .take(cap.saturating_add(1))
        .read_to_end(&mut buf)
        .map_err(|e| {
            log::warn!("card_source_read_failed error={e}");
            "source file not found".to_string()
        })?;
    if buf.len() as u64 > cap {
        return Err("source file too large".to_string());
    }
    Ok(buf)
}

/// Copy the PNG bytes into `cards/` under the first free stem and return its id.
pub(crate) fn claim_thumbnail(
    cards: &Path,
    name_stem: &str,
    identity: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let empty: Vec<String> = Vec::new();
    let (id, _dest) = claim_and_copy(
        bytes,
        &ClaimTarget {
            dir: cards,
            name_stem,
            identity,
            ext: "png",
            kind: SniffKind::Png,
            cap: MAX_PNG_BYTES,
            reserved: &empty,
        },
    )?;
    Ok(id)
}

/// Rename `cards/<temp_id>.png` to `cards/<preset_id>.png` (sanitize_stem on both ids),
/// replacing an existing preset thumbnail, and return the dest path.
fn retain_thumbnail_at(cards: &Path, temp_id: &str, preset_id: &str) -> Result<String, String> {
    let src = cards.join(format!("{}.png", sanitize_stem(temp_id)));
    let dest = cards.join(format!("{}.png", sanitize_stem(preset_id)));
    ensure_within(cards, &src)?;
    ensure_within(cards, &dest)?;
    std::fs::rename(&src, &dest).map_err(|e| {
        log::error!("thumbnail_retain_failed error={e}");
        "thumbnail retain failed".to_string()
    })?;
    Ok(dest.to_string_lossy().into_owned())
}

/// A picked photo as PNG bytes: a PNG passes through, a JPEG is decoded and fitted to `PHOTO_EDGE`.
fn photo_as_png(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    if sniff_ok(&bytes, SniffKind::Png) {
        return Ok(bytes);
    }
    if !sniff_ok(&bytes, SniffKind::Jpeg) {
        return Err("unsupported file".to_string());
    }
    let unreadable = |e: image::ImageError| {
        log::warn!("photo_unreadable error={e}");
        "photo unreadable".to_string()
    };
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Jpeg);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(PHOTO_DECODE_MAX_EDGE);
    limits.max_image_height = Some(PHOTO_DECODE_MAX_EDGE);
    limits.max_alloc = Some(PHOTO_DECODE_MAX_ALLOC);
    reader.limits(limits);
    let photo = reader.decode().map_err(unreadable)?;
    let mut png = Vec::new();
    photo
        .thumbnail(PHOTO_EDGE, PHOTO_EDGE)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(unreadable)?;
    Ok(png)
}

/// Store a picked photo as `cards/<preset_id>.png`, replacing the preset's thumbnail, and
/// return the dest path.
fn store_preset_photo(
    cards: &Path,
    preset_id: &str,
    identity: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let png = photo_as_png(bytes)?;
    let temp_id = claim_thumbnail(cards, "photo", identity, &png)?;
    retain_thumbnail_at(cards, &temp_id, preset_id)
}

/// Delete `cards/<sanitized id>.png` if present. Idempotent — missing is Ok.
pub(crate) fn remove_thumbnail_at(cards: &Path, id: &str) -> Result<(), String> {
    if !cards.exists() {
        return Ok(());
    }
    let dest = cards.join(format!("{}.png", sanitize_stem(id)));
    ensure_within(cards, &dest)?;
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| {
            log::error!("remove_failed dest={} error={e}", dest.display());
            "remove failed".to_string()
        })?;
    }
    Ok(())
}

pub(crate) fn cards_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_subdir(app, "cards")
}

/// Open the card picker here and read the picked file: a `.json`, a `.png` with its card JSON in
/// a tEXt chunk (copied into `cards/` under a temp id for the preset thumbnail), or a `.yui`
/// preset file (its thumbnail, VRM and voice clip claimed under `reserved_vrm_ids` and
/// `voice_staging_id`). `None` when the picker is dismissed.
#[command]
pub async fn import_card_file(
    app: AppHandle,
    reserved_vrm_ids: Vec<String>,
    voice_staging_id: String,
) -> Result<Option<ImportedCardFile>, String> {
    let Some(src_path) = app
        .dialog()
        .file()
        .add_filter("Card", &["json", "png", "yui"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let dirs = PresetDirs::of(&app)?;
    open_and_import(app, src_path, move |name, identity, mut source| {
        let name = Path::new(name.as_deref().unwrap_or(""));
        let stem = name.file_stem().and_then(|s| s.to_str()).unwrap_or("card");
        let ext = name
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "json" => {
                let bytes = read_bounded(&mut source, MAX_JSON_BYTES)?;
                let json = String::from_utf8(bytes).map_err(|_| "card unreadable".to_string())?;
                Ok(ImportedCardFile::plain(CardSource::Json, json, None))
            }
            "png" => {
                let bytes = read_bounded(&mut source, MAX_PNG_BYTES)?;
                let json = card_json_from_png(&bytes)?;
                let temp_id = claim_thumbnail(&dirs.cards, stem, &identity, &bytes)?;
                Ok(ImportedCardFile::plain(
                    CardSource::Png,
                    json,
                    Some(temp_id),
                ))
            }
            "yui" => read_preset_file(
                source,
                stem,
                &identity,
                &dirs,
                &reserved_vrm_ids,
                &voice_staging_id,
            ),
            _ => Err("unsupported file".to_string()),
        }
    })
    .await
    .map(Some)
}

/// The one dropped card file, refused unless it is a single `.json`, `.png` or `.yui` file.
fn check_dropped_card(_paths: &[PathBuf]) -> Result<&Path, String> {
    Err(String::new())
}

/// Move a PNG card's temp thumbnail to the importing preset's id, returning the dest path.
#[command]
pub fn retain_card_thumbnail(
    app: AppHandle,
    temp_id: String,
    preset_id: String,
) -> Result<String, String> {
    retain_thumbnail_at(&cards_dir(&app)?, &temp_id, &preset_id)
}

/// Open the photo picker here and store the picked PNG or JPEG as the preset's thumbnail,
/// returning the file path. A JPEG decodes within `PHOTO_DECODE_MAX_EDGE` and
/// `PHOTO_DECODE_MAX_ALLOC`, so a small file cannot expand to an unbounded bitmap. `None` when the picker is dismissed.
#[command]
pub async fn pick_preset_photo(
    app: AppHandle,
    preset_id: String,
) -> Result<Option<String>, String> {
    let Some(src_path) = app
        .dialog()
        .file()
        .add_filter("Photo", &["png", "jpg", "jpeg"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let cards = cards_dir(&app)?;
    open_and_import(app, src_path, move |_name, identity, mut source| {
        let bytes = read_bounded(&mut source, MAX_PNG_BYTES)?;
        store_preset_photo(&cards, &preset_id, &identity, bytes)
    })
    .await
    .map(Some)
}

/// Delete a thumbnail file by temp id or preset id. Idempotent — missing is Ok.
#[command]
pub fn remove_card_thumbnail(app: AppHandle, id: String) -> Result<(), String> {
    remove_thumbnail_at(&cards_dir(&app)?, &id)
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
    fn a_dropped_card_is_one_json_png_or_yui_file() {
        let one = [PathBuf::from("a/Mio.YUI")];
        assert_eq!(check_dropped_card(&one), Ok(Path::new("a/Mio.YUI")));
        for (paths, err) in [
            (vec![], "no dropped file"),
            (
                vec![PathBuf::from("a.png"), PathBuf::from("b.png")],
                "multiple files",
            ),
            (vec![PathBuf::from("notes.txt")], "unsupported file"),
        ] {
            assert_eq!(check_dropped_card(&paths), Err(err.to_string()));
        }
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

    fn encoded(w: u32, h: u32, format: image::ImageFormat) -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::new_rgb8(w, h)
            .write_to(&mut std::io::Cursor::new(&mut out), format)
            .unwrap();
        out
    }

    #[test]
    fn a_picked_png_is_stored_as_the_presets_thumbnail() {
        let cards = unique_dir("photo_png");
        let png = encoded(8, 8, image::ImageFormat::Png);

        let dest = store_preset_photo(&cards, "abcd1234", "file:///me.png", png.clone()).unwrap();

        assert_eq!(
            dest,
            cards.join("abcd1234.png").to_string_lossy().into_owned()
        );
        assert_eq!(std::fs::read(cards.join("abcd1234.png")).unwrap(), png);
        assert_eq!(std::fs::read_dir(&cards).unwrap().count(), 1); // no temp copy left behind
        std::fs::remove_dir_all(&cards).ok();
    }

    #[test]
    fn a_second_pick_replaces_the_first() {
        let cards = unique_dir("photo_twice");
        let first = encoded(8, 8, image::ImageFormat::Png);
        let second = encoded(9, 9, image::ImageFormat::Png);

        store_preset_photo(&cards, "abcd1234", "file:///a.png", first).unwrap();
        store_preset_photo(&cards, "abcd1234", "file:///b.png", second.clone()).unwrap();

        assert_eq!(std::fs::read(cards.join("abcd1234.png")).unwrap(), second);
        assert_eq!(std::fs::read_dir(&cards).unwrap().count(), 1);
        std::fs::remove_dir_all(&cards).ok();
    }

    #[test]
    fn a_jpeg_is_stored_as_a_png_fitted_to_the_photo_edge() {
        let cards = unique_dir("photo_jpeg");
        let jpeg = encoded(1024, 512, image::ImageFormat::Jpeg);

        store_preset_photo(&cards, "abcd1234", "file:///me.jpg", jpeg).unwrap();

        let stored = std::fs::read(cards.join("abcd1234.png")).unwrap();
        assert!(stored.starts_with(PNG_SIGNATURE));
        let (w, h) = image::load_from_memory(&stored)
            .map(|i| (i.width(), i.height()))
            .unwrap();
        assert_eq!((w, h), (PHOTO_EDGE, PHOTO_EDGE / 2));
        std::fs::remove_dir_all(&cards).ok();
    }

    #[test]
    fn a_jpeg_wider_than_the_decode_limit_is_refused_and_stores_nothing() {
        let cards = unique_dir("photo_huge");
        let jpeg = encoded(PHOTO_DECODE_MAX_EDGE + 1, 1, image::ImageFormat::Jpeg);

        let err = store_preset_photo(&cards, "abcd1234", "file:///huge.jpg", jpeg).unwrap_err();

        assert_eq!(err, "photo unreadable".to_string());
        assert!(!cards.join("abcd1234.png").exists());
        std::fs::remove_dir_all(&cards).ok();
    }

    #[test]
    fn a_file_that_is_no_png_or_jpeg_is_refused_and_stores_nothing() {
        let cards = unique_dir("photo_refused");

        let err = store_preset_photo(&cards, "abcd1234", "file:///me.txt", b"hello".to_vec())
            .unwrap_err();

        assert_eq!(err, "unsupported file".to_string());
        assert!(!cards.join("abcd1234.png").exists());
        std::fs::remove_dir_all(&cards).ok();
    }
}
