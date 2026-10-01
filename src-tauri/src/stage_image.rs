//! Stage background image import (native half).
//!
//! Streams a user-picked PNG, JPEG or WebP into `<app_data_dir>/stage/` through the fs plugin
//! (a plain path on desktop, a content URI on Android) and deletes a stored image by id.

use serde::Serialize;
use std::path::Path;

/// Imported stage image handle returned to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedStage {
    /// Stored file name including its extension.
    pub id: String,
    /// Absolute path of the copied file under app-data.
    pub dest_path: String,
}

fn import_into(
    stage_dir: &Path,
    name: Option<&str>,
    identity: &str,
    reader: impl std::io::Read,
    cap: u64,
) -> Result<ImportedStage, String> {
    let _ = (stage_dir, name, identity, reader, cap);
    Err("import failed".to_string())
}

fn remove_at(stage_dir: &Path, id: &str) -> Result<(), String> {
    let _ = (stage_dir, id);
    Ok(())
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
    fn rejects_bytes_that_do_not_match_the_extension_and_leaves_no_file() {
        let dir = stage_dir("mismatch");
        assert!(import(&dir, Some("fake.jpg"), b"just some text, not a jpeg", 1024).is_err());
        assert!(import(&dir, Some("fake.png"), JPEG, 1024).is_err());
        assert_eq!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0), 0);
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
    fn rejects_a_stream_over_the_cap_and_leaves_no_file() {
        let dir = stage_dir("cap");
        let mut big = PNG.to_vec();
        big.extend(std::iter::repeat_n(1u8, 4096));
        assert!(import(&dir, Some("big.png"), &big, 64).is_err());
        assert_eq!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0), 0);
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
