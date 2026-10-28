//! The per-call screenshot folder under the OS temp directory.

use std::io;
use std::path::PathBuf;
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

pub fn sweep_stale() {}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn sweep_stale_removes_old_folders_and_spares_fresh_ones() {
        let fresh = create().unwrap();
        let old = create().unwrap();
        std::fs::File::open(&old)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(3600))
            .unwrap();

        sweep_stale();

        assert!(fresh.exists());
        assert!(!old.exists());
        std::fs::remove_dir_all(fresh).unwrap();
    }
}
