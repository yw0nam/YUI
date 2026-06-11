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
