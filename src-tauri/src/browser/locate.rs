//! Finds the installed `ego-browser` CLI.

use std::path::PathBuf;

#[cfg(windows)]
const BIN: &str = "ego-browser.exe";
#[cfg(not(windows))]
const BIN: &str = "ego-browser";

/// `~/.local/bin/ego-browser` when it is a file, else the first `ego-browser` on `PATH`.
pub fn find_ego_browser() -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    home.map(|h| PathBuf::from(h).join(".local").join("bin").join(BIN))
        .into_iter()
        .chain(
            std::env::var_os("PATH")
                .iter()
                .flat_map(std::env::split_paths)
                .map(|dir| dir.join(BIN)),
        )
        .find(|p| p.is_file())
}
