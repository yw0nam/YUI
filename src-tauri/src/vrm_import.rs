//! Bring-your-own-VRM import (native half).
//!
//! Copies a user-picked `.vrm` from an arbitrary path into `<app_data_dir>/vrms/`
//! via a native command. A native `std::fs::copy` reads the arbitrary source with
//! the app's own privileges — the fs plugin would require the source path to be in
//! a pre-declared scope, which an OS file picker cannot satisfy.

use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::{command, AppHandle, Manager};

/// Imported VRM handle returned to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVrm {
    /// AvatarOption id (sanitized dest stem).
    pub id: String,
    /// Absolute path of the copied file under app-data.
    pub dest_path: String,
}

/// Sanitize a filename stem into an AvatarOption id charset (`[A-Za-z0-9._-]`).
/// Any other char becomes `_`. Collapses to `avatar` when nothing usable remains.
fn sanitize_stem(stem: &str) -> String {
    let out: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.chars().all(|c| c == '_') {
        return "avatar".to_string();
    }
    out
}

/// FNV-1a over the full source path → short stable hex suffix for disambiguation.
fn short_hash(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:x}", h & 0xffffff)
}

/// Derive the dest filename stem from a source path, disambiguating on collision.
/// `exists_different(stem)` reports whether a *different* file already owns `stem`.
fn derive_dest_stem(src: &Path, exists_different: impl Fn(&str) -> bool) -> String {
    let raw = src.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let base = sanitize_stem(raw);
    if !exists_different(&base) {
        return base;
    }
    let suffixed = format!("{}-{}", base, short_hash(&src.to_string_lossy()));
    if !exists_different(&suffixed) {
        return suffixed;
    }
    // Last resort: numeric walk.
    for n in 2.. {
        let candidate = format!("{}-{}", base, n);
        if !exists_different(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

/// True when `dest` exists and differs (by length) from `src` — a real collision.
fn collides(src: &Path, dest: &Path) -> bool {
    if !dest.exists() {
        return false;
    }
    match (std::fs::metadata(src), std::fs::metadata(dest)) {
        (Ok(a), Ok(b)) => a.len() != b.len(),
        _ => true,
    }
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
    use std::path::PathBuf;

    // ── sanitize_stem ────────────────────────────────────────────────────────

    #[test]
    fn sanitize_keeps_safe_chars() {
        assert_eq!(sanitize_stem("My_Avatar-1.0"), "My_Avatar-1.0");
    }

    #[test]
    fn sanitize_replaces_spaces_and_specials_with_underscore() {
        assert_eq!(sanitize_stem("my avatar (v2)"), "my_avatar__v2_");
    }

    #[test]
    fn sanitize_collapses_to_avatar_when_empty() {
        assert_eq!(sanitize_stem(""), "avatar");
        assert_eq!(sanitize_stem("   "), "avatar");
        assert_eq!(sanitize_stem("///"), "avatar");
    }

    #[test]
    fn sanitize_handles_unicode_by_dropping_to_safe() {
        let out = sanitize_stem("ナツメ");
        assert!(!out.is_empty());
        assert!(out.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)));
    }

    // ── derive_dest_stem ─────────────────────────────────────────────────────

    #[test]
    fn derive_uses_sanitized_stem_when_no_collision() {
        let src = PathBuf::from("/Users/me/Downloads/My Avatar.vrm");
        let stem = derive_dest_stem(&src, |_| false);
        assert_eq!(stem, "My_Avatar");
    }

    #[test]
    fn derive_disambiguates_on_collision_with_different_file() {
        let src = PathBuf::from("/a/b/Cat.vrm");
        let stem = derive_dest_stem(&src, |candidate| candidate == "Cat");
        assert_ne!(stem, "Cat");
        assert!(stem.starts_with("Cat"));
        assert!(stem.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)));
    }

    #[test]
    fn derive_is_deterministic_for_a_given_src_path() {
        let src = PathBuf::from("/a/b/Cat.vrm");
        let a = derive_dest_stem(&src, |c| c == "Cat");
        let b = derive_dest_stem(&src, |c| c == "Cat");
        assert_eq!(a, b);
    }

    #[test]
    fn derive_distinct_src_paths_disambiguate_differently() {
        let src1 = PathBuf::from("/dir-one/Cat.vrm");
        let src2 = PathBuf::from("/dir-two/Cat.vrm");
        let a = derive_dest_stem(&src1, |c| c == "Cat");
        let b = derive_dest_stem(&src2, |c| c == "Cat");
        assert_ne!(a, b);
    }

    // ── short_hash ───────────────────────────────────────────────────────────

    #[test]
    fn short_hash_is_safe_charset_and_stable() {
        let h = short_hash("/some/path/Cat.vrm");
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(h, short_hash("/some/path/Cat.vrm"));
    }
}
