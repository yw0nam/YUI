//! Bring-your-own-voice import (reference clip copy into app-data).
//!
//! Copies a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`.
//! A native `std::fs::copy` reads the arbitrary source with the app's own privileges.

use std::path::PathBuf;
use serde::Serialize;
use tauri::{command, AppHandle, Manager};
use crate::import_fs::{sanitize_stem, derive_dest_stem, collides};

/// Allowed audio file extensions (lowercase).
const AUDIO_EXTS: [&str; 8] = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "webm"];

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

/// Copy a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`.
#[command]
pub fn import_voice_file(app: AppHandle, src_path: String) -> Result<ImportedVoice, String> {
    let src = PathBuf::from(&src_path);

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    if !is_allowed_audio_ext(ext) {
        return Err(format!("unsupported audio type: {src_path}"));
    }
    if !src.is_file() {
        return Err(format!("source file not found: {src_path}"));
    }

    let ext_lower = ext.to_ascii_lowercase();

    let references_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?
        .join("references");

    let id = derive_dest_stem(&src, |candidate| {
        let clip = references_dir.join(candidate).join(format!("clip.{ext_lower}"));
        collides(&src, &clip)
    });

    let dir = references_dir.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create references dir failed: {e}"))?;

    let dest = dir.join(format!("clip.{ext_lower}"));
    std::fs::copy(&src, &dest).map_err(|e| format!("copy failed: {e}"))?;

    Ok(ImportedVoice {
        id,
        ref_path: dest.to_string_lossy().into_owned(),
    })
}

/// Delete `<app_data_dir>/references/<id>/` if present. Idempotent — missing is Ok.
#[command]
pub fn remove_user_voice(app: AppHandle, id: String) -> Result<(), String> {
    let sanitized = sanitize_stem(&id);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?
        .join("references")
        .join(sanitized);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("remove failed: {e}"))?;
    }
    Ok(())
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
}
