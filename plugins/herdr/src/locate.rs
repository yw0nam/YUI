//! Finds the installed `herdr` CLI and `ssh`.

use std::path::{Path, PathBuf};

#[cfg(windows)]
const BIN: &str = "herdr.exe";
#[cfg(not(windows))]
const BIN: &str = "herdr";

/// `~/.local/bin/herdr` when it is a file, else the first `herdr` on `PATH`.
pub fn find_herdr() -> Option<PathBuf> {
    // The plugin binary is also named herdr; never pick it as the CLI.
    let own = std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok());
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    home.map(|h| PathBuf::from(h).join(".local").join("bin").join(BIN))
        .into_iter()
        .chain(
            std::env::var_os("PATH")
                .iter()
                .flat_map(std::env::split_paths)
                .map(|dir| dir.join(BIN)),
        )
        .find(|p| p.is_file() && !is_own(p, own.as_deref()))
}

fn is_own(candidate: &Path, own: Option<&Path>) -> bool {
    match own {
        Some(own) => candidate.canonicalize().is_ok_and(|p| p == own),
        None => false,
    }
}

/// The first `ssh` on `PATH`.
#[cfg(unix)]
pub fn find_ssh() -> Option<PathBuf> {
    std::env::var_os("PATH")
        .iter()
        .flat_map(std::env::split_paths)
        .map(|dir| dir.join("ssh"))
        .find(|p| p.is_file())
}
