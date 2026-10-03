//! Stage background image import (native half).
//!
//! Streams a user-picked PNG, JPEG or WebP into `<app_data_dir>/stage/` through the fs plugin
//! (a plain path on desktop, a content URI on Android) and deletes a stored image by id.

use crate::import_fs::{
    app_data_subdir, claim_and_copy, ensure_within, image_ext, sanitize_stem, ClaimTarget,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions as FsOpenOptions};

/// Max accepted source size for a stage image import.
const MAX_STAGE_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

/// Extensions a stored stage image can carry (`jpeg` is stored as `jpg`).
const STORED_EXTS: [&str; 3] = ["png", "jpg", "webp"];

/// Imported stage image handle returned to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedStage {
    /// Stored file name including its extension.
    pub id: String,
    /// Absolute path of the copied file under app-data.
    pub dest_path: String,
}

/// Stream a validated image into `stage_dir` under the first free stem. `identity` (the source
/// path or URI) seeds the disambiguating hash; `name` is the source's display name.
fn import_into(
    stage_dir: &Path,
    name: Option<&str>,
    identity: &str,
    reader: impl std::io::Read,
    cap: u64,
) -> Result<ImportedStage, String> {
    let name = Path::new(
        name.filter(|n| !n.is_empty())
            .ok_or_else(|| "source name unavailable".to_string())?,
    );
    let (ext, kind) = name
        .extension()
        .and_then(|e| e.to_str())
        .and_then(image_ext)
        .ok_or_else(|| "unsupported image type".to_string())?;
    let name_stem = name.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let (stem, dest) = claim_and_copy(
        reader,
        &ClaimTarget {
            dir: stage_dir,
            name_stem,
            identity,
            ext,
            kind,
            cap,
            reserved: &[],
        },
    )?;
    Ok(ImportedStage {
        id: format!("{stem}.{ext}"),
        dest_path: dest.to_string_lossy().into_owned(),
    })
}

/// Delete `stage_dir/<id>` when `id` is a stored file name. Idempotent: a missing file is Ok.
fn remove_at(stage_dir: &Path, id: &str) -> Result<(), String> {
    let (stem, ext) = id
        .rsplit_once('.')
        .ok_or_else(|| "invalid stage image id".to_string())?;
    if !STORED_EXTS.contains(&ext) || sanitize_stem(stem) != stem {
        return Err("invalid stage image id".to_string());
    }
    if !stage_dir.exists() {
        return Ok(());
    }
    let dest = stage_dir.join(id);
    ensure_within(stage_dir, &dest)?;
    match std::fs::remove_file(&dest) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => {
            log::error!("remove_failed dest={} error={e}", dest.display());
            Err("remove failed".to_string())
        }
    }
}

fn stage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_subdir(app, "stage")
}

/// Stream a user-picked image (a path or a content URI) into `<app_data_dir>/stage/`, returning
/// its id + dest path.
#[command]
pub async fn import_stage_image(
    app: AppHandle,
    src_path: FilePath,
) -> Result<ImportedStage, String> {
    let stage_dir = stage_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let identity = src_path.to_string();
        let name = app.path().file_name(&identity);
        let mut opts = FsOpenOptions::new();
        opts.read(true);
        let source = app.fs().open(src_path, opts).map_err(|e| {
            log::error!("open_source_failed error={e}");
            "source file not found".to_string()
        })?;
        import_into(
            &stage_dir,
            name.as_deref(),
            &identity,
            source,
            MAX_STAGE_IMAGE_BYTES,
        )
    })
    .await
    .map_err(|e| {
        log::error!("import_task_failed error={e}");
        "import failed".to_string()
    })?
}

/// Delete `<app_data_dir>/stage/<id>` if present. Idempotent: missing is Ok.
#[command]
pub fn remove_stage_image(app: AppHandle, id: String) -> Result<(), String> {
    remove_at(&stage_dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRpixels";
    const JPEG: &[u8] = b"\xFF\xD8\xFF\xE0\x00\x10JFIFpixels";
    const WEBP: &[u8] = b"RIFF\x24\x00\x00\x00WEBPVP8 pixels";

    fn stage_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("yui_stage_test_{tag}_{nanos}"))
            .join("stage")
    }

    fn import(
        dir: &Path,
        name: Option<&str>,
        bytes: &[u8],
        cap: u64,
    ) -> Result<ImportedStage, String> {
        import_into(dir, name, "content://media/external/file/7", bytes, cap)
    }

    fn cleanup(dir: &Path) {
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn imports_each_format_under_its_name_and_extension() {
        let dir = stage_dir("formats");
        for (name, bytes, id) in [
            ("beach.png", PNG, "beach.png"),
            ("sky.jpg", JPEG, "sky.jpg"),
            ("dusk.webp", WEBP, "dusk.webp"),
        ] {
            let got = import(&dir, Some(name), bytes, 1024).unwrap();
            assert_eq!(got.id, id);
            assert_eq!(std::fs::read(dir.join(id)).unwrap(), bytes);
            assert_eq!(got.dest_path, dir.join(id).to_string_lossy());
        }
        cleanup(&dir);
    }

    #[test]
    fn stores_jpeg_as_jpg_and_lowercases_the_extension() {
        let dir = stage_dir("jpeg");
        assert_eq!(
            import(&dir, Some("a.jpeg"), JPEG, 1024).unwrap().id,
            "a.jpg"
        );
        assert_eq!(import(&dir, Some("b.PNG"), PNG, 1024).unwrap().id, "b.png");
        cleanup(&dir);
    }

    #[test]
    fn rejects_an_unsupported_extension_or_a_missing_name() {
        let dir = stage_dir("ext");
        assert!(import(&dir, Some("a.gif"), PNG, 1024).is_err());
        assert!(import(&dir, Some("noext"), PNG, 1024).is_err());
        assert!(import(&dir, None, PNG, 1024).is_err());
        cleanup(&dir);
    }

    #[test]
    fn remove_deletes_a_stored_image() {
        let dir = stage_dir("rm");
        let got = import(&dir, Some("beach.png"), PNG, 1024).unwrap();
        remove_at(&dir, &got.id).unwrap();
        assert!(!dir.join("beach.png").exists());
        cleanup(&dir);
    }

    #[test]
    fn remove_is_idempotent_for_a_missing_file_or_directory() {
        let dir = stage_dir("rm_missing");
        assert!(remove_at(&dir, "gone.png").is_ok());
        std::fs::create_dir_all(&dir).unwrap();
        assert!(remove_at(&dir, "gone.png").is_ok());
        cleanup(&dir);
    }

    #[test]
    fn remove_rejects_an_unsafe_id_and_keeps_every_file() {
        let dir = stage_dir("rm_unsafe");
        std::fs::create_dir_all(&dir).unwrap();
        let sibling = dir.parent().unwrap().join("keep.png");
        std::fs::write(&sibling, b"x").unwrap();
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        for id in [
            "../keep.png",
            "a/b.png",
            "a.jpeg",
            "a.gif",
            "a",
            ".png",
            "..",
            "a.PNG",
        ] {
            assert!(remove_at(&dir, id).is_err(), "accepted {id:?}");
        }
        assert!(sibling.exists());
        assert!(dir.join("a.jpg").exists());
        cleanup(&dir);
    }
}
