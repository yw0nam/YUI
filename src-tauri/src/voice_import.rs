//! Bring-your-own-voice import (reference clip copy into app-data).
//!
//! Copies a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`.
//! A native `std::fs::copy` reads the arbitrary source with the app's own privileges.

use crate::import_fs::{audio_sniff_kind, ensure_within, sanitize_stem, sniff_file};
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
    /// Voice id (sanitized dest stem).
    pub id: String,
    /// Absolute path of the copied clip under app-data.
    pub ref_path: String,
}

/// Copy a validated audio source into `references_dir/<id>/clip.<ext_lower>`, where `<id>` is
/// `sanitize_stem(desired_name)`. Overwrites any existing directory of that id — the caller
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

    let id = sanitize_stem(desired_name);

    let dir = references_dir.join(&id);
    ensure_within(references_dir, &dir)?;

    // Build the replacement in a sibling temp dir first, so a failure here never touches the
    // existing `dir` — sanitize_stem never emits a leading dot, so this can't collide with a
    // real voice id. Clear any leftover from a prior failed attempt before starting.
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

/// Delete `references_dir/<sanitized id>/` if present. Idempotent — missing is Ok.
fn remove_user_voice_at(references_dir: &Path, id: &str) -> Result<(), String> {
    if !references_dir.exists() {
        return Ok(());
    }
    let dir = references_dir.join(sanitize_stem(id));
    ensure_within(references_dir, &dir)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| {
            log::error!("remove_failed dest={} error={e}", dir.display());
            "remove failed".to_string()
        })?;
    }
    Ok(())
}

/// Copy a user-picked audio file into `<app_data_dir>/references/<id>/clip.<ext>`, where `<id>`
/// is the sanitized form of `desired_name` — the name the user typed in the naming row.
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
    // RED: not implemented yet — pin the contract in tests first.
    let _ = parse_stale_artifact("");
    let _ = references_dir;
    unimplemented!("recovery sweep not yet implemented")
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

    #[test]
    fn copy_into_registers_under_a_utf8_desired_name_verbatim() {
        let dir = unique_dir("utf8_name");
        let references = dir.join("references");
        let src = dir.join("src.mp3");
        std::fs::write(&src, b"ID3\x04\x00\x00\x00\x00").unwrap();

        let imported = copy_into_references(&references, &src, "mp3", "ナツメ").unwrap();
        assert_eq!(imported.id, "ナツメ");
        assert!(references.join("ナツメ").join("clip.mp3").exists());
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
        assert!(!backup.exists(), "the backup path itself must be gone once restored");
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
}
