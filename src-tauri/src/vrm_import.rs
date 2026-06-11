//! Bring-your-own-VRM import (native half).
//!
//! Copies a user-picked `.vrm` from an arbitrary path into `<app_data_dir>/vrms/`
//! via a native command. A native `std::fs::copy` reads the arbitrary source with
//! the app's own privileges — the fs plugin would require the source path to be in
//! a pre-declared scope, which an OS file picker cannot satisfy.

use std::path::PathBuf;
use serde::Serialize;
use tauri::{command, AppHandle, Manager};
use crate::import_fs::{sanitize_stem, derive_dest_stem, collides};

/// Imported VRM handle returned to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVrm {
    /// AvatarOption id (sanitized dest stem).
    pub id: String,
    /// Absolute path of the copied file under app-data.
    pub dest_path: String,
}

/// Copy a user-picked `.vrm` into `<app_data_dir>/vrms/`, returning its id + dest path.
#[command]
pub fn import_vrm_file(app: AppHandle, src_path: String) -> Result<ImportedVrm, String> {
    let src = PathBuf::from(&src_path);

    if src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("vrm"))
        != Some(true)
    {
        return Err(format!("not a .vrm file: {src_path}"));
    }
    if !src.is_file() {
        return Err(format!("source file not found: {src_path}"));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?
        .join("vrms");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create vrms dir failed: {e}"))?;

    let stem = derive_dest_stem(&src, |candidate| {
        collides(&src, &dir.join(format!("{candidate}.vrm")))
    });
    let dest = dir.join(format!("{stem}.vrm"));

    std::fs::copy(&src, &dest).map_err(|e| format!("copy failed: {e}"))?;

    Ok(ImportedVrm {
        id: stem,
        dest_path: dest.to_string_lossy().into_owned(),
    })
}

/// Delete `<app_data_dir>/vrms/<id>.vrm` if present. Idempotent — missing is Ok.
#[command]
pub fn remove_user_vrm(app: AppHandle, id: String) -> Result<(), String> {
    let sanitized = sanitize_stem(&id);
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?
        .join("vrms")
        .join(format!("{sanitized}.vrm"));
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| format!("remove failed: {e}"))?;
    }
    Ok(())
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

    #[test]
    fn copy_into_rejects_oversized_source() {
        let dir = unique_dir("oversize");
        let src = dir.join("big.vrm");
        // Sparse file larger than the cap, without writing the bytes.
        let f = std::fs::File::create(&src).unwrap();
        f.set_len(MAX_VRM_BYTES + 1).unwrap();
        drop(f);
        let err = copy_into_vrms(&dir.join("dest"), Path::new(&src));
        assert!(err.is_err(), "oversized source must be rejected");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_into_disambiguates_on_existing_dest() {
        let dir = unique_dir("collide");
        let vrms = dir.join("vrms");
        std::fs::create_dir_all(&vrms).unwrap();
        std::fs::write(vrms.join("Cat.vrm"), b"existing").unwrap();
        let src = dir.join("Cat.vrm");
        std::fs::write(&src, b"new bytes").unwrap();

        let imported = copy_into_vrms(&vrms, Path::new(&src)).unwrap();
        assert_ne!(imported.id, "Cat", "must not overwrite the existing dest");
        assert!(vrms.join("Cat.vrm").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
