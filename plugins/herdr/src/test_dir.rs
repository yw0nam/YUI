//! A per-test temp directory, removed on drop even when the test panics.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub struct TempDir(PathBuf);

impl TempDir {
    /// A short name under the temp dir, since a unix socket path inside it is capped near 104 bytes.
    pub fn new(tag: &str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "yui-herdr-{tag}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    /// Writes an executable `/bin/sh` script into the directory.
    pub fn script(&self, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let bin = self.0.join(name);
        std::fs::write(&bin, body).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// One argv per call a fake script recorded in `argv.log`, fields split on \x1f.
    pub fn argv_calls(&self) -> Vec<Vec<String>> {
        let text = std::fs::read_to_string(self.0.join("argv.log")).unwrap_or_default();
        text.lines()
            .map(|l| {
                l.split('\u{1f}')
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect()
            })
            .collect()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
