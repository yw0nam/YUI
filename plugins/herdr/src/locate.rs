//! Finds the installed `herdr` CLI and `ssh`.

use std::path::PathBuf;

pub fn find_herdr() -> Option<PathBuf> {
    None
}

#[cfg(unix)]
pub fn find_ssh() -> Option<PathBuf> {
    None
}