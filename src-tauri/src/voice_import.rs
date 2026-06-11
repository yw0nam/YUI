//! Bring-your-own-voice import (reference clip copy into app-data).
//!
//! Copies a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`.
//! A native `std::fs::copy` reads the arbitrary source with the app's own privileges.

use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::{command, AppHandle, Manager};
use crate::import_fs::{
    sanitize_stem, derive_dest_stem, collides, ensure_within, audio_sniff_kind, sniff_file,
};

/// Allowed audio file extensions (lowercase).
const AUDIO_EXTS: [&str; 8] = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "webm"];

/// Max accepted source size for a voice-clip import.
const MAX_AUDIO_BYTES: u64 = 100 * 1024 * 1024;

/// True when `ext` (case-insensitive) is in the allowlist.
fn is_allowed_audio_ext(ext: &str) -> bool {
    let lower = ext.to_ascii_lowercase();
    AUDIO_EXTS.iter().any(|&e| e == lower)
}

/// Imported voice handle returned to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVoice {
    /// Voice id (sanitized dest stem).
    pub id: String,
    /// Absolute path of the copied clip under app-data.
    pub ref_path: String,
}

/// Copy a validated audio source into `references_dir/<id>/clip.<ext_lower>`.
fn copy_into_references(
    references_dir: &Path,
    src: &Path,
    ext_lower: &str,
) -> Result<ImportedVoice, String> {
    let src = src.canonicalize().map_err(|_| "source file not found".to_string())?;
    if !src.is_file() {
        return Err("source file not found".to_string());
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !is_allowed_audio_ext(ext) {
        return Err("unsupported audio type".to_string());
    }
    if std::fs::metadata(&src).map_err(|_| "source file not found".to_string())?.len() > MAX_AUDIO_BYTES {
        return Err("source file too large".to_string());
    }
    let kind = audio_sniff_kind(ext_lower).ok_or("unsupported audio type".to_string())?;
    if !sniff_file(&src, kind)? {
        return Err("unsupported audio type".to_string());
    }

    std::fs::create_dir_all(references_dir).map_err(|e| {
        log::error!("create references dir failed at {}: {e}", references_dir.display());
        "storage unavailable".to_string()
    })?;

    let id = derive_dest_stem(&src, |candidate| {
        collides(&references_dir.join(candidate).join(format!("clip.{ext_lower}")))
    });

    let dir = references_dir.join(&id);
    ensure_within(references_dir, &dir)?;
    std::fs::create_dir_all(&dir).map_err(|e| {
        log::error!("create references dir failed at {}: {e}", dir.display());
        "storage unavailable".to_string()
    })?;

    let dest = dir.join(format!("clip.{ext_lower}"));
    std::fs::copy(&src, &dest).map_err(|e| {
        log::error!("copy to {} failed: {e}", dest.display());
        "import failed".to_string()
    })?;

    Ok(ImportedVoice {
        id,
        ref_path: dest.to_string_lossy().into_owned(),
    })
}

/// Delete `references_dir/<sanitized id>/` if present. Idempotent — missing is Ok.
fn remove_user_voice_at(references_dir: &Path, id: &str) -> Result<(), String> {
    if !references_dir.exists() {
        return Ok(());
    }
    let dir = references_dir.join(sanitize_stem(id));
    ensure_within(references_dir, &dir)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| {
            log::error!("remove {} failed: {e}", dir.display());
            "remove failed".to_string()
        })?;
    }
    Ok(())
}

/// Copy a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`.
#[command]
pub fn import_voice_file(app: AppHandle, src_path: String) -> Result<ImportedVoice, String> {
    let src = PathBuf::from(&src_path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !is_allowed_audio_ext(ext) {
        return Err("unsupported audio type".to_string());
    }
    let ext_lower = ext.to_ascii_lowercase();

    let references_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            log::error!("app_data_dir unavailable: {e}");
            "storage unavailable".to_string()
        })?
        .join("references");

    copy_into_references(&references_dir, &src, &ext_lower)
}

/// Delete `<app_data_dir>/references/<id>/` if present. Idempotent — missing is Ok.
#[command]
pub fn remove_user_voice(app: AppHandle, id: String) -> Result<(), String> {
    let references_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            log::error!("app_data_dir unavailable: {e}");
            "storage unavailable".to_string()
        })?
        .join("references");
    remove_user_voice_at(&references_dir, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_ext_allowlist_has_eight_entries() {
        assert_eq!(AUDIO_EXTS.len(), 8);
    }

    #[test]
    fn is_allowed_accepts_all_listed_exts_lowercase() {
        for ext in &AUDIO_EXTS {
            assert!(
                is_allowed_audio_ext(ext),
                "expected '{}' to be allowed",
                ext
            );
        }
    }

    #[test]
    fn is_allowed_accepts_uppercase_variants() {
        assert!(is_allowed_audio_ext("MP3"));
        assert!(is_allowed_audio_ext("Wav"));
        assert!(is_allowed_audio_ext("OGG"));
        assert!(is_allowed_audio_ext("FLAC"));
    }

    #[test]
    fn is_allowed_rejects_non_audio_exts() {
        assert!(!is_allowed_audio_ext("txt"));
        assert!(!is_allowed_audio_ext("vrm"));
        assert!(!is_allowed_audio_ext(""));
        assert!(!is_allowed_audio_ext("mp4"));
    }

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("yui_voice_test_{tag}_{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn remove_at_deletes_a_normal_id_dir() {
        let references = unique_dir("rm_ok");
        let voice = references.join("Cat");
        std::fs::create_dir_all(&voice).unwrap();
        std::fs::write(voice.join("clip.mp3"), b"x").unwrap();
        remove_user_voice_at(&references, "Cat").unwrap();
        assert!(!voice.exists());
        std::fs::remove_dir_all(&references).ok();
    }

    #[test]
    fn remove_at_rejects_dotdot_id_and_keeps_siblings() {
        let app_data = unique_dir("rm_escape");
        let references = app_data.join("references");
        std::fs::create_dir_all(&references).unwrap();
        let sibling = app_data.join("sessions");
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("keep.json"), b"keep me").unwrap();

        let _ = remove_user_voice_at(&references, "..");

        assert!(app_data.exists(), "app-data parent must survive a `..` id");
        assert!(sibling.exists(), "sibling dir must not be deleted");
        std::fs::remove_dir_all(&app_data).ok();
    }

    #[test]
    fn remove_at_missing_is_ok() {
        let references = unique_dir("rm_missing");
        assert!(remove_user_voice_at(&references, "nope").is_ok());
        std::fs::remove_dir_all(&references).ok();
    }

    #[test]
    fn copy_into_rejects_oversized_source() {
        let dir = unique_dir("oversize");
        let src = dir.join("big.wav");
        let f = std::fs::File::create(&src).unwrap();
        f.set_len(MAX_AUDIO_BYTES + 1).unwrap();
        drop(f);
        let err = copy_into_references(&dir.join("references"), &src, "wav");
        assert!(err.is_err(), "oversized source must be rejected");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_disambiguates_on_existing_dest() {
        let dir = unique_dir("collide");
        let references = dir.join("references");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"existing").unwrap();
        let src = dir.join("Cat.wav");
        std::fs::write(&src, b"RIFF\x24\x08\x00\x00WAVEfmt ").unwrap();

        let imported = copy_into_references(&references, &src, "wav").unwrap();
        assert_ne!(imported.id, "Cat", "must not overwrite the existing dest");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_rejects_bogus_audio_magic_and_copies_nothing() {
        let dir = unique_dir("bad_magic");
        let references = dir.join("references");
        let src = dir.join("fake.wav");
        std::fs::write(&src, b"not really wav audio data").unwrap();

        let res = copy_into_references(&references, &src, "wav");
        assert!(res.is_err(), "non-WAV content must be rejected");
        assert!(
            !references.join("fake").exists(),
            "no partial copy on sniff failure"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_accepts_valid_audio_magic() {
        let dir = unique_dir("good_magic");
        let references = dir.join("references");
        let src = dir.join("real.ogg");
        std::fs::write(&src, b"OggS\x00\x02\x00\x00\x00\x00\x00\x00").unwrap();

        let imported = copy_into_references(&references, &src, "ogg").unwrap();
        assert_eq!(imported.id, "real");
        assert!(references.join("real").join("clip.ogg").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_errors_carry_no_path_separators() {
        let dir = unique_dir("err_generic");
        let src = dir.join("fake.wav");
        std::fs::write(&src, b"not wav").unwrap();
        let err = copy_into_references(&dir.join("references"), &src, "wav").unwrap_err();
        assert!(!err.contains('/'), "error must not leak a path: {err:?}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
