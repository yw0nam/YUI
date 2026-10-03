//! Bring-your-own-voice import (reference clip copy into app-data).
//!
//! Copies a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`.
//! A native `std::fs::copy` reads the arbitrary source with the app's own privileges.

use crate::import_fs::{
    app_data_subdir, audio_sniff_kind, ensure_within, sanitize_stem, short_hash, sniff_file,
    MAX_STEM_BYTES,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle};

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
    /// Voice id in the TTS server's `[A-Za-z0-9_-]` charset, derived by `voice_id_from_name`.
    pub id: String,
    /// Absolute path of the copied clip under app-data.
    pub ref_path: String,
}

/// Derive the voice id sent to the TTS server from the user-typed name: `sanitize_stem` first
/// (traversal / control-char / reserved-name / length handling), then mapped to the server's
/// `[A-Za-z0-9_-]` charset — every other char becomes `_`, runs collapse, ends are trimmed.
/// Whenever that loses information, a `short_hash(name)` suffix keeps distinct names distinct
/// while the same name keeps mapping to the same id; a name with nothing to keep becomes
/// `voice-<hash>`. Losslessness deliberately compares against the raw trimmed name, not the
/// sanitized one — so e.g. "CON" becomes `avatar-<hash>` and cannot collide with a voice
/// literally named "avatar". The suffixed form caps its base so the id never exceeds
/// MAX_STEM_BYTES, keeping every id a `sanitize_stem` fixpoint.
fn voice_id_from_name(name: &str) -> String {
    let name = name.trim();
    let mut base = String::new();
    for c in sanitize_stem(name).chars() {
        if c.is_ascii_alphanumeric() || c == '-' {
            base.push(c);
        } else if !base.ends_with('_') {
            base.push('_');
        }
    }
    let base = base.trim_matches('_');
    if base.is_empty() {
        return format!("voice-{}", short_hash(name));
    }
    if base == name {
        return base.to_string();
    }
    let hash = short_hash(name);
    // `base` is ASCII by construction, so the byte slice cannot split a char. The `- 1` is the
    // `-` separator byte between base and hash.
    let cap = MAX_STEM_BYTES - 1 - hash.len();
    let base = if base.len() > cap {
        base[..cap].trim_end_matches('_')
    } else {
        base
    };
    format!("{base}-{hash}")
}

/// Copy a validated audio source into `references_dir/<id>/clip.<ext_lower>`, where `<id>` is
/// `voice_id_from_name(desired_name)`. The destination directory must not exist: the import
/// fails with "storage unavailable" and leaves a directory already holding that id untouched.
fn copy_into_references(
    references_dir: &Path,
    src: &Path,
    ext_lower: &str,
    desired_name: &str,
) -> Result<ImportedVoice, String> {
    if desired_name.trim().is_empty() {
        return Err("voice name required".to_string());
    }
    let src = src
        .canonicalize()
        .map_err(|_| "source file not found".to_string())?;
    if !src.is_file() {
        return Err("source file not found".to_string());
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !is_allowed_audio_ext(ext) {
        return Err("unsupported audio type".to_string());
    }
    if std::fs::metadata(&src)
        .map_err(|_| "source file not found".to_string())?
        .len()
        > MAX_AUDIO_BYTES
    {
        return Err("source file too large".to_string());
    }
    let kind = audio_sniff_kind(ext_lower).ok_or("unsupported audio type".to_string())?;
    if !sniff_file(&src, kind)? {
        return Err("unsupported audio type".to_string());
    }

    std::fs::create_dir_all(references_dir).map_err(|e| {
        log::error!(
            "create_references_dir_failed dest={} error={e}",
            references_dir.display()
        );
        "storage unavailable".to_string()
    })?;

    let id = voice_id_from_name(desired_name);

    let dir = references_dir.join(&id);
    ensure_within(references_dir, &dir)?;

    // Build the voice in a sibling temp dir first, so `dir` only ever appears fully built —
    // voice_id_from_name never emits a leading dot, so this can't collide with a real voice
    // id. Clear any leftover from a prior failed attempt before starting.
    let tmp_dir = references_dir.join(format!(".{id}.import-tmp"));
    ensure_within(references_dir, &tmp_dir)?;
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).map_err(|e| {
        log::error!(
            "create_references_dir_failed dest={} error={e}",
            tmp_dir.display()
        );
        "storage unavailable".to_string()
    })?;

    let tmp_dest = tmp_dir.join(format!("clip.{ext_lower}"));
    if let Err(e) = std::fs::copy(&src, &tmp_dest) {
        log::error!("copy_failed dest={} error={e}", tmp_dest.display());
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err("import failed".to_string());
    }

    // Move the fully-built temp dir into place. The rename fails when `dir` already holds a
    // voice, which leaves that voice as it is.
    if let Err(e) = std::fs::rename(&tmp_dir, &dir) {
        log::error!("swap_rename_failed dest={} error={e}", dir.display());
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err("storage unavailable".to_string());
    }

    let dest = dir.join(format!("clip.{ext_lower}"));
    Ok(ImportedVoice {
        id,
        ref_path: dest.to_string_lossy().into_owned(),
    })
}

/// Delete `references_dir/<sanitized id>/` if present. Idempotent — missing is Ok. Also clears
/// any `.{id}.import-tmp` for the same id.
fn remove_user_voice_at(references_dir: &Path, id: &str) -> Result<(), String> {
    if !references_dir.exists() {
        return Ok(());
    }
    let sanitized = sanitize_stem(id);
    let dir = references_dir.join(&sanitized);
    ensure_within(references_dir, &dir)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| {
            log::error!("remove_failed dest={} error={e}", dir.display());
            "remove failed".to_string()
        })?;
    }

    let tmp_dir = references_dir.join(format!(".{sanitized}.import-tmp"));
    ensure_within(references_dir, &tmp_dir)?;
    let _ = std::fs::remove_dir_all(&tmp_dir);

    Ok(())
}

/// Move `references_dir/<from>/` to `references_dir/<to>/` and return the clip under its new id.
/// `to` must be an id `voice_id_from_name` itself produces; a `from` already gone while `to`
/// exists counts as moved, so a rename interrupted before the caller persisted it completes.
fn rename_user_voice_at(
    references_dir: &Path,
    from: &str,
    to: &str,
) -> Result<ImportedVoice, String> {
    if voice_id_from_name(to) != to || sanitize_stem(from) != from {
        return Err("invalid voice id".to_string());
    }
    let src = references_dir.join(from);
    let dest = references_dir.join(to);
    ensure_within(references_dir, &src)?;
    ensure_within(references_dir, &dest)?;
    if src.exists() {
        if dest.exists() {
            return Err("voice id taken".to_string());
        }
        std::fs::rename(&src, &dest).map_err(|e| {
            log::error!("voice_rename_failed dest={} error={e}", dest.display());
            "storage unavailable".to_string()
        })?;
    } else if !dest.exists() {
        return Err("voice not found".to_string());
    }
    let clip = std::fs::read_dir(&dest)
        .map_err(|_| "voice not found".to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.file_stem().is_some_and(|s| s == "clip"))
        .ok_or("voice not found".to_string())?;
    Ok(ImportedVoice {
        id: to.to_string(),
        ref_path: clip.to_string_lossy().into_owned(),
    })
}

/// Copy a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`, where `<id>`
/// is the server-charset voice id `voice_id_from_name` derives from the typed `desired_name`.
#[command]
pub fn import_voice_file(
    app: AppHandle,
    src_path: String,
    desired_name: String,
) -> Result<ImportedVoice, String> {
    let src = PathBuf::from(&src_path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !is_allowed_audio_ext(ext) {
        return Err("unsupported audio type".to_string());
    }
    let ext_lower = ext.to_ascii_lowercase();

    let references_dir = app_data_subdir(&app, "references")?;

    copy_into_references(&references_dir, &src, &ext_lower, &desired_name)
}

/// Delete `<app_data_dir>/references/<id>/` if present. Idempotent — missing is Ok.
#[command]
pub fn remove_user_voice(app: AppHandle, id: String) -> Result<(), String> {
    let references_dir = app_data_subdir(&app, "references")?;
    remove_user_voice_at(&references_dir, &id)
}

/// Move `<app_data_dir>/references/<from>/` to `<app_data_dir>/references/<to>/`.
#[command]
pub fn rename_user_voice(
    app: AppHandle,
    from: String,
    to: String,
) -> Result<ImportedVoice, String> {
    let references_dir = app_data_subdir(&app, "references")?;
    rename_user_voice_at(&references_dir, &from, &to)
}

/// Startup cleanup for `copy_into_references`: a process death mid-import leaves a
/// `.{id}.import-tmp` that never finished building, so every one is discarded. A missing
/// `references_dir` is a no-op — nothing has ever imported.
pub(crate) fn sweep_stale_import_artifacts(references_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(references_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if name.starts_with('.') && name.ends_with(".import-tmp") {
            if let Err(e) = std::fs::remove_dir_all(entry.path()) {
                log::error!("stale_tmp_sweep_failed name={name} error={e}");
            }
        }
    }
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
        let err = copy_into_references(&dir.join("references"), &src, "wav", "Big");
        assert!(err.is_err(), "oversized source must be rejected");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_refuses_a_desired_name_whose_directory_exists() {
        let dir = unique_dir("existing_dest");
        let references = dir.join("references");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"existing").unwrap();
        let src = dir.join("New.wav");
        std::fs::write(&src, b"RIFF\x24\x08\x00\x00WAVEfmt ").unwrap();

        let err = copy_into_references(&references, &src, "wav", "Cat").unwrap_err();

        assert_eq!(err, "storage unavailable");
        assert_eq!(
            std::fs::read(references.join("Cat").join("clip.wav")).unwrap(),
            b"existing",
            "the existing clip must stay byte-identical"
        );
        assert!(
            !references.join(".Cat.import-tmp").exists(),
            "the tmp dir must not outlive a refused import"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_rejects_empty_desired_name() {
        let dir = unique_dir("empty_name");
        let src = dir.join("real.wav");
        std::fs::write(&src, b"RIFF\x24\x08\x00\x00WAVEfmt ").unwrap();
        let err = copy_into_references(&dir.join("references"), &src, "wav", "").unwrap_err();
        assert!(
            err.contains("name"),
            "error should mention the name: {err:?}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_rejects_whitespace_only_desired_name() {
        let dir = unique_dir("blank_name");
        let src = dir.join("real.wav");
        std::fs::write(&src, b"RIFF\x24\x08\x00\x00WAVEfmt ").unwrap();
        let err = copy_into_references(&dir.join("references"), &src, "wav", "   ").unwrap_err();
        assert!(
            err.contains("name"),
            "error should mention the name: {err:?}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    fn is_server_safe_id(s: &str) -> bool {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    }

    #[test]
    fn copy_into_registers_a_utf8_desired_name_under_a_server_safe_ascii_id() {
        let dir = unique_dir("utf8_name");
        let references = dir.join("references");
        let src = dir.join("src.mp3");
        std::fs::write(&src, b"ID3\x04\x00\x00\x00\x00").unwrap();

        let imported = copy_into_references(&references, &src, "mp3", "ナツメ").unwrap();
        assert!(
            is_server_safe_id(&imported.id),
            "id must match the TTS server's [A-Za-z0-9_-] charset: {:?}",
            imported.id
        );
        assert!(references.join(&imported.id).join("clip.mp3").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── voice_id_from_name ───────────────────────────────────────────────────

    #[test]
    fn voice_id_non_ascii_name_yields_a_hashed_server_safe_id() {
        let id = voice_id_from_name("エイメス");
        assert!(is_server_safe_id(&id), "{id:?}");
        assert!(
            id.starts_with("voice-"),
            "a fully non-ASCII name falls back to voice-<hash>: {id:?}"
        );
    }

    #[test]
    fn voice_id_is_stable_for_the_same_name() {
        assert_eq!(
            voice_id_from_name("エイメス"),
            voice_id_from_name("エイメス")
        );
    }

    #[test]
    fn voice_id_distinct_non_ascii_names_yield_distinct_ids() {
        assert_ne!(voice_id_from_name("エイメス"), voice_id_from_name("ナツメ"));
    }

    #[test]
    fn voice_id_server_safe_name_passes_through_unchanged() {
        assert_eq!(voice_id_from_name("My_Voice-1"), "My_Voice-1");
        assert_eq!(voice_id_from_name("Cat"), "Cat");
    }

    #[test]
    fn voice_id_spaced_name_maps_to_underscores_with_a_hash_suffix() {
        let id = voice_id_from_name("my avatar (v2)");
        assert!(is_server_safe_id(&id), "{id:?}");
        assert!(
            id.starts_with("my_avatar_v2-"),
            "spaces/parens map to collapsed underscores plus a hash: {id:?}"
        );
    }

    #[test]
    fn voice_id_is_a_sanitize_stem_fixpoint_within_the_byte_cap() {
        // Every consumer relies on sanitize_stem(id) == id: remove_user_voice_at re-derives the
        // directory from sanitize_stem(id), and speaker-selection.ts drops persisted ids where
        // sanitizeStem(id) !== id. 150 pins import_fs.rs's MAX_STEM_BYTES.
        let long_ascii = "a".repeat(200);
        let long_lossy = format!("{} {}", "x".repeat(100), "y".repeat(99));
        let long_unicode = "あ".repeat(120);
        let names = [
            "Cat",
            "My_Voice-1",
            "my avatar (v2)",
            " spaced name ",
            "エイメス",
            "ナツメ",
            "CON",
            "con.txt",
            "!!!",
            "..",
            "../../etc/passwd",
            long_ascii.as_str(),
            long_lossy.as_str(),
            long_unicode.as_str(),
        ];
        for name in names {
            let id = voice_id_from_name(name);
            assert!(
                id.len() <= 150,
                "voice_id_from_name({name:?}) is {} bytes, over the stem cap: {id:?}",
                id.len()
            );
            assert_eq!(
                sanitize_stem(&id),
                id,
                "voice_id_from_name({name:?}) is not a sanitize_stem fixpoint"
            );
        }
    }

    #[test]
    fn voice_id_matches_the_shared_cross_language_fixture() {
        // Shared with src/io/assets/safe-id.test.ts's voiceIdFromName mirror — a single source of truth
        // for what voice_id_from_name produces, so the Rust and TS derivations cannot drift.
        let raw = include_str!("../../fixtures/voice-id-cases.json");
        let cases: Vec<serde_json::Value> = serde_json::from_str(raw).unwrap();
        assert!(!cases.is_empty(), "fixture must not be empty");
        for case in &cases {
            let input = case["input"].as_str().unwrap();
            let expected = case["expected"].as_str().unwrap();
            assert_eq!(
                voice_id_from_name(input),
                expected,
                "voice_id_from_name({input:?}) mismatch"
            );
        }
    }

    #[test]
    fn remove_at_deletes_the_directory_of_a_lossy_imported_id() {
        let dir = unique_dir("roundtrip_lossy");
        let references = dir.join("references");
        let src = dir.join("src.mp3");
        std::fs::write(&src, b"ID3\x04\x00\x00\x00\x00").unwrap();

        let imported = copy_into_references(&references, &src, "mp3", "エイメス").unwrap();
        assert!(references.join(&imported.id).exists());

        remove_user_voice_at(&references, &imported.id).unwrap();
        assert!(
            !references.join(&imported.id).exists(),
            "delete must remove the directory of the id it registered under"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn voice_id_of_a_long_lossy_name_stays_capped_and_round_trips_through_remove() {
        let dir = unique_dir("roundtrip_long");
        let references = dir.join("references");
        let src = dir.join("src.mp3");
        std::fs::write(&src, b"ID3\x04\x00\x00\x00\x00").unwrap();
        let name = format!("{} {}", "x".repeat(100), "y".repeat(99));

        let imported = copy_into_references(&references, &src, "mp3", &name).unwrap();
        assert!(
            imported.id.len() <= 150,
            "a 200-char lossy name must still yield an id within the stem cap: {} bytes",
            imported.id.len()
        );
        assert!(references.join(&imported.id).exists());

        remove_user_voice_at(&references, &imported.id).unwrap();
        assert!(
            !references.join(&imported.id).exists(),
            "delete must remove the exact id directory, not a truncation of it"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_sanitizes_a_traversal_desired_name() {
        let dir = unique_dir("traversal_name");
        let references = dir.join("references");
        let src = dir.join("src.mp3");
        std::fs::write(&src, b"ID3\x04\x00\x00\x00\x00").unwrap();

        let imported = copy_into_references(&references, &src, "mp3", "../../etc/passwd").unwrap();
        assert_ne!(imported.id, "../../etc/passwd");
        assert!(!imported.id.contains('/'));
        assert!(references.join(&imported.id).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_rejects_bogus_audio_magic_and_copies_nothing() {
        let dir = unique_dir("bad_magic");
        let references = dir.join("references");
        let src = dir.join("fake.wav");
        std::fs::write(&src, b"not really wav audio data").unwrap();

        let res = copy_into_references(&references, &src, "wav", "Fake");
        assert!(res.is_err(), "non-WAV content must be rejected");
        assert!(
            !references.join("Fake").exists(),
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

        let imported = copy_into_references(&references, &src, "ogg", "real").unwrap();
        assert_eq!(imported.id, "real");
        assert!(references.join("real").join("clip.ogg").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_errors_carry_no_path_separators() {
        let dir = unique_dir("err_generic");
        let src = dir.join("fake.wav");
        std::fs::write(&src, b"not wav").unwrap();
        let err = copy_into_references(&dir.join("references"), &src, "wav", "Fake").unwrap_err();
        assert!(!err.contains('/'), "error must not leak a path: {err:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── rename_user_voice_at ─────────────────────────────────────────────────

    #[test]
    fn rename_at_moves_the_voice_dir_and_returns_its_clip() {
        let references = unique_dir("rename_ok");
        std::fs::create_dir_all(references.join("芳乃")).unwrap();
        std::fs::write(references.join("芳乃").join("clip.wav"), b"clip").unwrap();
        let to = voice_id_from_name("芳乃");

        let renamed = rename_user_voice_at(&references, "芳乃", &to).unwrap();

        assert_eq!(renamed.id, to);
        assert_eq!(
            PathBuf::from(&renamed.ref_path),
            references.join(&to).join("clip.wav")
        );
        assert_eq!(
            std::fs::read(references.join(&to).join("clip.wav")).unwrap(),
            b"clip"
        );
        assert!(!references.join("芳乃").exists());
        std::fs::remove_dir_all(&references).ok();
    }

    #[test]
    fn rename_at_refuses_a_to_outside_references_and_moves_nothing() {
        let app_data = unique_dir("rename_escape");
        let references = app_data.join("references");
        std::fs::create_dir_all(references.join("希")).unwrap();
        std::fs::write(references.join("希").join("clip.wav"), b"clip").unwrap();

        for to in ["../escaped", "..", "sub/dir", "希"] {
            assert!(
                rename_user_voice_at(&references, "希", to).is_err(),
                "{to:?} must be refused"
            );
        }
        assert!(references.join("希").join("clip.wav").exists());
        assert!(!app_data.join("escaped").exists());
        std::fs::remove_dir_all(&app_data).ok();
    }

    #[test]
    fn rename_at_refuses_when_both_folders_exist_and_changes_neither() {
        let references = unique_dir("rename_taken");
        let to = voice_id_from_name("芳乃");
        std::fs::create_dir_all(references.join("芳乃")).unwrap();
        std::fs::write(references.join("芳乃").join("clip.wav"), b"old").unwrap();
        std::fs::create_dir_all(references.join(&to)).unwrap();
        std::fs::write(references.join(&to).join("clip.wav"), b"new").unwrap();

        assert!(rename_user_voice_at(&references, "芳乃", &to).is_err());

        assert_eq!(
            std::fs::read(references.join("芳乃").join("clip.wav")).unwrap(),
            b"old"
        );
        assert_eq!(
            std::fs::read(references.join(&to).join("clip.wav")).unwrap(),
            b"new"
        );
        std::fs::remove_dir_all(&references).ok();
    }

    #[test]
    fn rename_at_completes_a_rename_whose_folder_already_moved() {
        let references = unique_dir("rename_retry");
        let to = voice_id_from_name("希");
        std::fs::create_dir_all(references.join(&to)).unwrap();
        std::fs::write(references.join(&to).join("clip.mp3"), b"clip").unwrap();

        let renamed = rename_user_voice_at(&references, "希", &to).unwrap();

        assert_eq!(
            PathBuf::from(&renamed.ref_path),
            references.join(&to).join("clip.mp3")
        );
        std::fs::remove_dir_all(&references).ok();
    }

    // ── sweep_stale_import_artifacts ─────────────────────────────────────────

    #[test]
    fn sweep_always_clears_a_stale_tmp_dir() {
        let references = unique_dir("sweep_tmp");
        let tmp = references.join(".Cat.import-tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("clip.wav"), b"half-built").unwrap();
        // Whether or not the id already exists, a tmp dir never resumes.
        std::fs::create_dir_all(references.join("Cat")).unwrap();

        sweep_stale_import_artifacts(&references);

        assert!(!tmp.exists(), "a stale tmp dir must always be cleared");
        assert!(
            references.join("Cat").exists(),
            "an unrelated existing id dir must survive the sweep"
        );
        std::fs::remove_dir_all(&references).ok();
    }

    #[test]
    fn sweep_of_an_empty_or_missing_dir_is_a_no_op() {
        let references = unique_dir("sweep_empty");
        sweep_stale_import_artifacts(&references);
        assert!(references.exists());
        std::fs::remove_dir_all(&references).ok();

        let missing = references; // now-removed path — never created again
        sweep_stale_import_artifacts(&missing);
    }

    #[test]
    fn remove_at_clears_a_stale_tmp_for_the_deleted_id() {
        let references = unique_dir("remove_clears_tmp");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        let tmp = references.join(".Cat.import-tmp");
        std::fs::create_dir_all(&tmp).unwrap();

        remove_user_voice_at(&references, "Cat").unwrap();

        assert!(
            !tmp.exists(),
            "a stale tmp for the deleted id must be cleared too"
        );
        std::fs::remove_dir_all(&references).ok();
    }
}
