//! Bring-your-own-VRM import (native half).
//!
//! Copies a user-picked `.vrm` from an arbitrary path into `<app_data_dir>/vrms/`
//! via a native command. A native `std::fs::copy` reads the arbitrary source with
//! the app's own privileges — the fs plugin would require the source path to be in
//! a pre-declared scope, which an OS file picker cannot satisfy.

use crate::import_fs::{
    collides, derive_dest_stem, ensure_within, sanitize_stem, sniff_file, SniffKind,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

/// Max accepted source size for a VRM import.
const MAX_VRM_BYTES: u64 = 512 * 1024 * 1024;

/// Imported VRM handle returned to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVrm {
    /// AvatarOption id (sanitized dest stem).
    pub id: String,
    /// Absolute path of the copied file under app-data.
    pub dest_path: String,
}

/// Copy a validated `.vrm` source into `vrms_dir`, disambiguating the dest stem.
fn copy_into_vrms(vrms_dir: &Path, src: &Path) -> Result<ImportedVrm, String> {
    let src = src
        .canonicalize()
        .map_err(|_| "source file not found".to_string())?;
    if !src.is_file() {
        return Err("source file not found".to_string());
    }
    if src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("vrm"))
        != Some(true)
    {
        return Err("not a .vrm file".to_string());
    }
    if std::fs::metadata(&src)
        .map_err(|_| "source file not found".to_string())?
        .len()
        > MAX_VRM_BYTES
    {
        return Err("source file too large".to_string());
    }
    if !sniff_file(&src, SniffKind::Glb)? {
        return Err("not a .vrm file".to_string());
    }

    std::fs::create_dir_all(vrms_dir).map_err(|e| {
        log::error!(
            "create_vrms_dir_failed dest={} error={e}",
            vrms_dir.display()
        );
        "storage unavailable".to_string()
    })?;

    let stem = derive_dest_stem(&src, |candidate| {
        collides(&vrms_dir.join(format!("{candidate}.vrm")))
    });
    let dest = vrms_dir.join(format!("{stem}.vrm"));
    ensure_within(vrms_dir, &dest)?;

    std::fs::copy(&src, &dest).map_err(|e| {
        log::error!("copy_failed dest={} error={e}", dest.display());
        "import failed".to_string()
    })?;

    Ok(ImportedVrm {
        id: stem,
        dest_path: dest.to_string_lossy().into_owned(),
    })
}

/// Stream a validated `.vrm` into `vrms_dir` under a fresh, non-reserved id.
fn import_into(
    vrms_dir: &Path,
    name: Option<&str>,
    identity: &str,
    reserved: &[String],
    reader: impl std::io::Read,
    cap: u64,
) -> Result<ImportedVrm, String> {
    let _ = (vrms_dir, name, identity, reserved, reader, cap);
    unimplemented!()
}

/// Delete `vrms_dir/<sanitized id>.vrm` if present. Idempotent — missing is Ok.
fn remove_user_vrm_at(vrms_dir: &Path, id: &str) -> Result<(), String> {
    if !vrms_dir.exists() {
        return Ok(());
    }
    let dest = vrms_dir.join(format!("{}.vrm", sanitize_stem(id)));
    ensure_within(vrms_dir, &dest)?;
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| {
            log::error!("remove_failed dest={} error={e}", dest.display());
            "remove failed".to_string()
        })?;
    }
    Ok(())
}

/// Copy a user-picked `.vrm` into `<app_data_dir>/vrms/`, returning its id + dest path.
#[command]
pub fn import_vrm_file(app: AppHandle, src_path: String) -> Result<ImportedVrm, String> {
    let vrms_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            log::error!("app_data_dir_unavailable error={e}");
            "storage unavailable".to_string()
        })?
        .join("vrms");
    copy_into_vrms(&vrms_dir, &PathBuf::from(&src_path))
}

/// Delete `<app_data_dir>/vrms/<id>.vrm` if present. Idempotent — missing is Ok.
#[command]
pub fn remove_user_vrm(app: AppHandle, id: String) -> Result<(), String> {
    let vrms_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            log::error!("app_data_dir_unavailable error={e}");
            "storage unavailable".to_string()
        })?
        .join("vrms");
    remove_user_vrm_at(&vrms_dir, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("yui_vrm_test_{tag}_{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn remove_at_deletes_a_normal_id_clip() {
        let vrms = unique_dir("rm_ok");
        let target = vrms.join("Cat.vrm");
        std::fs::write(&target, b"x").unwrap();
        remove_user_vrm_at(&vrms, "Cat").unwrap();
        assert!(!target.exists());
        std::fs::remove_dir_all(&vrms).ok();
    }

    #[test]
    fn remove_at_rejects_dotdot_id_and_keeps_siblings() {
        let app_data = unique_dir("rm_escape");
        let vrms = app_data.join("vrms");
        std::fs::create_dir_all(&vrms).unwrap();
        let sibling = app_data.join("configs.json");
        std::fs::write(&sibling, b"keep me").unwrap();

        let _ = remove_user_vrm_at(&vrms, "..");

        assert!(app_data.exists(), "app-data parent must survive a `..` id");
        assert!(sibling.exists(), "sibling file must not be deleted");
        std::fs::remove_dir_all(&app_data).ok();
    }

    #[test]
    fn remove_at_missing_is_ok() {
        let vrms = unique_dir("rm_missing");
        assert!(remove_user_vrm_at(&vrms, "nope").is_ok());
        std::fs::remove_dir_all(&vrms).ok();
    }

    const GLB: &[u8] = b"glTF\x02\x00\x00\x00binary chunk";

    fn import(
        vrms: &Path,
        name: Option<&str>,
        reserved: &[&str],
        bytes: &[u8],
    ) -> Result<ImportedVrm, String> {
        let reserved: Vec<String> = reserved.iter().map(|s| s.to_string()).collect();
        import_into(
            vrms,
            name,
            "content://media/external/file/42",
            &reserved,
            bytes,
            1024,
        )
    }

    fn leftovers(vrms: &Path) -> Vec<String> {
        std::fs::read_dir(vrms)
            .map(|d| {
                d.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn import_into_copies_a_valid_stream_under_its_stem() {
        let vrms = unique_dir("good").join("vrms");
        let imported = import(&vrms, Some("real.vrm"), &[], GLB).unwrap();
        assert_eq!(imported.id, "real");
        assert_eq!(std::fs::read(vrms.join("real.vrm")).unwrap(), GLB);
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_needs_a_display_name() {
        let vrms = unique_dir("noname").join("vrms");
        assert!(import(&vrms, None, &[], GLB).is_err());
        assert!(leftovers(&vrms).is_empty());
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_rejects_a_name_without_the_vrm_extension() {
        let vrms = unique_dir("ext").join("vrms");
        assert!(import(&vrms, Some("model.glb"), &[], GLB).is_err());
        assert!(leftovers(&vrms).is_empty());
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_rejects_bad_magic_and_leaves_no_file() {
        let vrms = unique_dir("bad_magic").join("vrms");
        assert!(import(&vrms, Some("fake.vrm"), &[], b"%PDF-1.4 not a vrm at all").is_err());
        assert!(
            leftovers(&vrms).is_empty(),
            "no partial copy on sniff failure"
        );
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_removes_the_partial_file_when_the_stream_exceeds_the_cap() {
        let vrms = unique_dir("oversize").join("vrms");
        let mut big = GLB.to_vec();
        big.extend(std::iter::repeat_n(7u8, 4096));
        let err = import_into(&vrms, Some("big.vrm"), "id", &[], &big[..], 64);
        assert!(err.is_err(), "oversized stream must be rejected");
        assert!(leftovers(&vrms).is_empty(), "partial copy must be removed");
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_moves_to_the_next_stem_on_an_existing_dest() {
        let vrms = unique_dir("collide").join("vrms");
        std::fs::create_dir_all(&vrms).unwrap();
        std::fs::write(vrms.join("Cat.vrm"), b"existing").unwrap();
        let imported = import(&vrms, Some("Cat.vrm"), &[], GLB).unwrap();
        assert_ne!(imported.id, "Cat");
        assert_eq!(std::fs::read(vrms.join("Cat.vrm")).unwrap(), b"existing");
        assert_eq!(
            std::fs::read(vrms.join(format!("{}.vrm", imported.id))).unwrap(),
            GLB
        );
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_gives_a_reserved_bundled_id_a_different_stem() {
        let vrms = unique_dir("reserved").join("vrms");
        let imported = import(
            &vrms,
            Some("Sendagaya_Shino.vrm"),
            &["Sendagaya_Shino"],
            GLB,
        )
        .unwrap();
        assert_ne!(imported.id, "Sendagaya_Shino");
        assert!(!vrms.join("Sendagaya_Shino.vrm").exists());
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_keeps_a_utf8_filename_stem_verbatim() {
        let vrms = unique_dir("utf8_stem").join("vrms");
        let imported = import(&vrms, Some("ナツメ.vrm"), &[], GLB).unwrap();
        assert_eq!(imported.id, "ナツメ");
        assert!(vrms.join("ナツメ.vrm").exists());
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }

    #[test]
    fn import_into_errors_carry_no_path_separators() {
        let vrms = unique_dir("err_generic").join("vrms");
        let err = import(&vrms, Some("fake.vrm"), &[], b"not a vrm").unwrap_err();
        assert!(
            !err.contains('/'),
            "error must not leak a path or URI: {err:?}"
        );
        std::fs::remove_dir_all(vrms.parent().unwrap()).ok();
    }
}
