//! The per-call screenshot folder under the OS temp directory.

use crate::image_encode::encode_capture;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const PREFIX: &str = "yui-browser-";

/// Makes a new empty folder named `yui-browser-<pid>-<nanos>-<counter>`.
pub fn create() -> io::Result<PathBuf> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let dir = std::env::temp_dir().join(format!(
        "{PREFIX}{}-{nanos}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir(&dir)?;
    Ok(dir)
}

#[derive(Debug, Default)]
pub struct Collected {
    /// JPEG data URLs, in file-name order.
    pub images: Vec<String>,
    /// Earlier screenshots left out by the cap.
    pub dropped: u32,
    /// File names that did not decode as an image.
    pub unreadable: Vec<String>,
}

/// Reads the last `cap` `*.png` files of `dir` in file-name order and encodes each at `long_edge`.
pub async fn collect(dir: PathBuf, cap: usize, long_edge: u32) -> Collected {
    tauri::async_runtime::spawn_blocking(move || collect_blocking(&dir, cap, long_edge))
        .await
        .unwrap_or_else(|e| {
            log::error!("browser_shots_join_failed error={e}");
            Collected::default()
        })
}

fn collect_blocking(dir: &Path, cap: usize, long_edge: u32) -> Collected {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.ends_with(".png"))
        .collect();
    names.sort();
    let dropped = names.len().saturating_sub(cap);
    let mut collected = Collected {
        dropped: dropped as u32,
        ..Collected::default()
    };
    for name in names.into_iter().skip(dropped) {
        let encoded = std::fs::read(dir.join(&name))
            .map_err(|e| e.to_string())
            .and_then(|bytes| image::load_from_memory(&bytes).map_err(|e| e.to_string()))
            .and_then(|img| encode_capture(img.to_rgba8(), long_edge));
        match encoded {
            Ok(data_url) => collected.images.push(data_url),
            Err(e) => {
                log::warn!("browser_shot_unreadable file={name} error={e}");
                collected.unreadable.push(name);
            }
        }
    }
    collected
}

/// Deletes `dir` off the async runtime, ignoring errors.
pub async fn remove(dir: PathBuf) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::fs::remove_dir_all(dir)).await;
}

/// Removes every `yui-browser-*` folder left in the temp directory, e.g. one a killed script recreated late.
pub fn sweep_stale() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(PREFIX) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}
