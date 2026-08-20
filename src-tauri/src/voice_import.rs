//! Bring-your-own-voice import (reference clip copy into app-data).
//!
//! Copies a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`.
//! A native `std::fs::copy` reads the arbitrary source with the app's own privileges.

use crate::import_fs::{
    audio_sniff_kind, ensure_within, sanitize_stem, short_hash, sniff_file, MAX_STEM_BYTES,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

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
/// `voice_id_from_name(desired_name)`. Overwrites any existing directory of that id — the caller
/// chose the name explicitly, so a collision is intentional replacement, not disambiguation.
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

    // Build the replacement in a sibling temp dir first, so a failure here never touches the
    // existing `dir` — voice_id_from_name never emits a leading dot, so this can't collide
    // with a real voice id. Clear any leftover from a prior failed attempt before starting.
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

    // Swap the fully-built temp dir into place. If `dir` already exists (overwrite), move it
    // aside first so the destination of the final rename is always absent — a failure partway
    // through restores the original instead of leaving neither old nor new content behind.
    let backup_dir = references_dir.join(format!(".{id}.import-backup"));
    ensure_within(references_dir, &backup_dir)?;
    let _ = std::fs::remove_dir_all(&backup_dir);
    let had_existing = dir.exists();
    if had_existing {
        if let Err(e) = std::fs::rename(&dir, &backup_dir) {
            log::error!("backup_rename_failed dest={} error={e}", dir.display());
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err("storage unavailable".to_string());
        }
    }
    if let Err(e) = std::fs::rename(&tmp_dir, &dir) {
        log::error!("swap_rename_failed dest={} error={e}", dir.display());
        // Restore the previous voice — this is the path that matters most.
        if had_existing {
            let _ = std::fs::rename(&backup_dir, &dir);
        }
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err("storage unavailable".to_string());
    }
    // New content is live — the backup is no longer needed (best-effort cleanup).
    if had_existing {
        let _ = std::fs::remove_dir_all(&backup_dir);
    }

    let dest = dir.join(format!("clip.{ext_lower}"));
    Ok(ImportedVoice {
        id,
        ref_path: dest.to_string_lossy().into_owned(),
    })
}

/// Delete `references_dir/<sanitized id>/` if present. Idempotent — missing is Ok. Also clears
/// any `.{id}.import-tmp` / `.{id}.import-backup` for the same id, so a leftover backup can't
/// resurrect this voice on the next startup sweep (`sweep_stale_import_artifacts`).
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

    let backup_dir = references_dir.join(format!(".{sanitized}.import-backup"));
    ensure_within(references_dir, &backup_dir)?;
    let _ = std::fs::remove_dir_all(&backup_dir);

    Ok(())
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

    let references_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            log::error!("app_data_dir_unavailable error={e}");
            "storage unavailable".to_string()
        })?
        .join("references");

    copy_into_references(&references_dir, &src, &ext_lower, &desired_name)
}

/// Delete `<app_data_dir>/references/<id>/` if present. Idempotent — missing is Ok.
#[command]
pub fn remove_user_voice(app: AppHandle, id: String) -> Result<(), String> {
    let references_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            log::error!("app_data_dir_unavailable error={e}");
            "storage unavailable".to_string()
        })?
        .join("references");
    remove_user_voice_at(&references_dir, &id)
}

/// A `copy_into_references` transactional sibling left behind by a process death between its
/// two renames (backup-aside, then tmp-into-place).
enum StaleArtifact<'a> {
    /// `.{id}.import-tmp` — a build-in-progress; never resumable, always discarded.
    Tmp,
    /// `.{id}.import-backup` — the pre-swap original, still holding the id it belongs to.
    Backup(&'a str),
}

/// Recognize `.{id}.import-tmp` / `.{id}.import-backup`; anything else is `None`.
fn parse_stale_artifact(file_name: &str) -> Option<StaleArtifact<'_>> {
    let rest = file_name.strip_prefix('.')?;
    if rest.ends_with(".import-tmp") {
        return Some(StaleArtifact::Tmp);
    }
    let id = rest.strip_suffix(".import-backup")?;
    Some(StaleArtifact::Backup(id))
}

/// Startup recovery for `copy_into_references`'s one unclosed failure window: a process death
/// between renaming the old `<id>` dir aside and renaming the new one into place. Restores a
/// `.{id}.import-backup` when `<id>` is missing (the swap never completed), otherwise deletes it
/// (the swap completed; the backup is a leftover). A `.{id}.import-tmp` never finished building,
/// so it is always discarded. A missing `references_dir` is a no-op — nothing has ever imported.
pub(crate) fn sweep_stale_import_artifacts(references_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(references_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        match parse_stale_artifact(name) {
            Some(StaleArtifact::Tmp) => {
                if let Err(e) = std::fs::remove_dir_all(entry.path()) {
                    log::error!("stale_tmp_sweep_failed name={name} error={e}");
                }
            }
            Some(StaleArtifact::Backup(id)) => {
                let target = references_dir.join(id);
                if let Err(e) = ensure_within(references_dir, &target) {
                    log::error!("stale_backup_target_escapes name={name} error={e}");
                    continue;
                }
                // A restore renames this entry straight into a voice-id slot — refuse anything
                // that isn't a real directory (e.g. a symlink) so it can't be promoted into one.
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if !is_dir {
                    log::error!("stale_backup_not_a_dir name={name}");
                    continue;
                }
                let result = if target.exists() {
                    std::fs::remove_dir_all(entry.path())
                } else {
                    std::fs::rename(entry.path(), &target)
                };
                if let Err(e) = result {
                    log::error!("stale_backup_sweep_failed name={name} error={e}");
                }
            }
            None => {}
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
    fn copy_into_overwrites_an_existing_dest_of_the_same_desired_name() {
        let dir = unique_dir("overwrite");
        let references = dir.join("references");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"existing").unwrap();
        let src = dir.join("New.wav");
        std::fs::write(&src, b"RIFF\x24\x08\x00\x00WAVEfmt ").unwrap();

        let imported = copy_into_references(&references, &src, "wav", "Cat").unwrap();
        assert_eq!(
            imported.id, "Cat",
            "must register under the typed name, not a suffix"
        );
        let clip = std::fs::read(references.join("Cat").join("clip.wav")).unwrap();
        assert_eq!(
            clip, b"RIFF\x24\x08\x00\x00WAVEfmt ",
            "old clip content must be replaced"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_overwrite_survives_a_failure_before_the_swap() {
        // Block the copy-into-tmp step deterministically and portably: pre-occupy the exact tmp
        // path the overwrite builds new content in with a plain file, so create_dir_all(tmp) fails
        // before the destructive old-dir removal/swap ever runs. The previous voice must survive.
        let dir = unique_dir("overwrite_fails_before_swap");
        let references = dir.join("references");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"original clip").unwrap();
        std::fs::write(references.join(".Cat.import-tmp"), b"blocking file").unwrap();
        let src = dir.join("New.wav");
        std::fs::write(&src, b"RIFF\x24\x08\x00\x00WAVEfmt ").unwrap();

        let result = copy_into_references(&references, &src, "wav", "Cat");

        assert!(result.is_err(), "a blocked tmp path must fail the import");
        assert_eq!(
            std::fs::read(references.join("Cat").join("clip.wav")).unwrap(),
            b"original clip",
            "the previous clip must survive a failed overwrite"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_overwrite_leaves_no_tmp_or_backup_artifacts_on_success() {
        let dir = unique_dir("overwrite_cleanup");
        let references = dir.join("references");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"existing").unwrap();
        let src = dir.join("New.wav");
        std::fs::write(&src, b"RIFF\x24\x08\x00\x00WAVEfmt ").unwrap();

        copy_into_references(&references, &src, "wav", "Cat").unwrap();

        let entries: Vec<_> = std::fs::read_dir(&references)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            entries,
            vec!["Cat".to_string()],
            "no .Cat.import-tmp / .Cat.import-backup leftovers after a successful overwrite"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_overwrite_removes_a_stale_clip_with_a_different_extension() {
        // Old dest had a .wav clip; new import for the same name is .mp3 — the stale .wav must
        // not linger alongside the new .mp3 (directory is fully replaced, not merged).
        let dir = unique_dir("overwrite_ext_change");
        let references = dir.join("references");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"old wav").unwrap();
        let src = dir.join("New.mp3");
        std::fs::write(&src, b"ID3\x04\x00\x00\x00\x00").unwrap();

        let imported = copy_into_references(&references, &src, "mp3", "Cat").unwrap();
        assert_eq!(imported.id, "Cat");
        assert!(references.join("Cat").join("clip.mp3").exists());
        assert!(
            !references.join("Cat").join("clip.wav").exists(),
            "stale clip with the old extension must not survive an overwrite"
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
        assert_eq!(voice_id_from_name("エイメス"), voice_id_from_name("エイメス"));
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
        // Shared with src/io/safe-id.test.ts's voiceIdFromName mirror — a single source of truth
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

    // ── sweep_stale_import_artifacts: startup recovery for the unclosed rename window ────────

    #[test]
    fn sweep_restores_a_backup_when_its_target_is_missing() {
        let references = unique_dir("sweep_restore");
        let backup = references.join(".Cat.import-backup");
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("clip.wav"), b"original clip").unwrap();

        sweep_stale_import_artifacts(&references);

        assert!(
            references.join("Cat").join("clip.wav").exists(),
            "the backup must be restored under the id it belongs to"
        );
        assert_eq!(
            std::fs::read(references.join("Cat").join("clip.wav")).unwrap(),
            b"original clip"
        );
        assert!(
            !backup.exists(),
            "the backup path itself must be gone once restored"
        );
        std::fs::remove_dir_all(&references).ok();
    }

    #[test]
    fn sweep_deletes_a_backup_when_its_target_already_exists() {
        let references = unique_dir("sweep_delete_backup");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"live clip").unwrap();
        let backup = references.join(".Cat.import-backup");
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("clip.wav"), b"orphaned backup").unwrap();

        sweep_stale_import_artifacts(&references);

        assert!(!backup.exists(), "an orphaned backup must be discarded");
        assert_eq!(
            std::fs::read(references.join("Cat").join("clip.wav")).unwrap(),
            b"live clip",
            "the swap that already completed must be untouched"
        );
        std::fs::remove_dir_all(&references).ok();
    }

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
    fn sweep_restores_a_backup_and_discards_a_tmp_present_together_for_the_same_id() {
        // The exact mid-swap-death state: the old dir was already renamed aside (backup exists)
        // and a next import for the same id was mid-build (tmp exists) when the process died.
        let references = unique_dir("sweep_tmp_and_backup");
        let backup = references.join(".Cat.import-backup");
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("clip.wav"), b"original clip").unwrap();
        let tmp = references.join(".Cat.import-tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("clip.wav"), b"half-built").unwrap();

        sweep_stale_import_artifacts(&references);

        assert!(!tmp.exists(), "the half-built tmp must be discarded");
        assert!(
            !backup.exists(),
            "the backup path itself must be gone once restored"
        );
        assert_eq!(
            std::fs::read(references.join("Cat").join("clip.wav")).unwrap(),
            b"original clip",
            "the backup must be restored under the id it belongs to, regardless of read_dir order"
        );
        std::fs::remove_dir_all(&references).ok();
    }

    // ── remove_user_voice_at: must not leave a resurrectable backup behind ───────────────────

    #[test]
    fn remove_at_also_clears_a_stale_backup_so_the_next_sweep_does_not_resurrect_it() {
        // Simulates a successful swap whose best-effort backup cleanup failed: the live voice
        // and an orphaned `.Cat.import-backup` coexist. Deleting the voice must also clear the
        // backup — otherwise the next startup sweep sees backup-without-target and restores the
        // deleted audio right back to disk.
        let references = unique_dir("remove_clears_backup");
        std::fs::create_dir_all(references.join("Cat")).unwrap();
        std::fs::write(references.join("Cat").join("clip.wav"), b"live clip").unwrap();
        let backup = references.join(".Cat.import-backup");
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("clip.wav"), b"stale backup").unwrap();

        remove_user_voice_at(&references, "Cat").unwrap();

        assert!(
            !references.join("Cat").exists(),
            "the voice itself must be gone"
        );
        assert!(
            !backup.exists(),
            "the stale backup must be cleared by the same delete, not left for the sweep to find"
        );

        sweep_stale_import_artifacts(&references);
        assert!(
            !references.join("Cat").exists(),
            "the next sweep must not resurrect deleted audio from a stale backup"
        );
        std::fs::remove_dir_all(&references).ok();
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

    // ── sweep_stale_import_artifacts: restore target must be a real dir inside references_dir ─

    #[cfg(unix)]
    #[test]
    fn sweep_skips_a_symlinked_backup_instead_of_promoting_it_to_a_voice_id() {
        use std::os::unix::fs::symlink;

        let root = unique_dir("sweep_symlink");
        let references = root.join("references");
        std::fs::create_dir_all(&references).unwrap();
        let outside = root.join("outside_secret");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("clip.wav"), b"not a voice").unwrap();

        let symlinked_backup = references.join(".Evil.import-backup");
        symlink(&outside, &symlinked_backup).unwrap();

        sweep_stale_import_artifacts(&references);

        assert!(
            !references.join("Evil").exists(),
            "a symlinked backup must never be promoted into a live voice id slot"
        );
        assert!(
            symlinked_backup.exists(),
            "a rejected symlinked backup is left in place, not silently deleted"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
