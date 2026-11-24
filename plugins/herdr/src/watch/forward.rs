//! Holds an `ssh -N -L` forward to a remote herdr socket.

use std::path::{Path, PathBuf};

pub fn home_args(_target: &str) -> Vec<String> {
    Vec::new()
}

pub fn forward_args(_target: &str, _local: &Path, _remote: &str) -> Vec<String> {
    Vec::new()
}

pub fn check_path(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub struct Forward {
    local: PathBuf,
}

impl Forward {
    pub fn socket(&self) -> &Path {
        &self.local
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::watch::machines;

    #[test]
    fn ssh_argument_lists_and_the_socket_path_limit() {
        assert_eq!(
            home_args("user@host"),
            ["-o", "BatchMode=yes", "user@host", "printf", "%s", "$HOME"].map(String::from)
        );
        assert_eq!(
            machines::remote_socket("/home/u", "default"),
            "/home/u/.config/herdr/herdr.sock"
        );
        assert_eq!(
            machines::remote_socket("/home/u", "work"),
            "/home/u/.config/herdr/sessions/work/herdr.sock"
        );
        assert_eq!(
            forward_args(
                "user@host",
                Path::new("/tmp/yui-herdr-1/0.sock"),
                "/home/u/.config/herdr/herdr.sock"
            ),
            [
                "-N",
                "-o",
                "BatchMode=yes",
                "-L",
                "/tmp/yui-herdr-1/0.sock:/home/u/.config/herdr/herdr.sock",
                "user@host"
            ]
            .map(String::from)
        );
        assert_eq!(
            forward_args(
                "user@host",
                Path::new("/tmp/yui-herdr-1/1.sock"),
                "/home/u/.config/herdr/sessions/work/herdr.sock"
            ),
            [
                "-N",
                "-o",
                "BatchMode=yes",
                "-L",
                "/tmp/yui-herdr-1/1.sock:/home/u/.config/herdr/sessions/work/herdr.sock",
                "user@host"
            ]
            .map(String::from)
        );
        assert!(check_path(Path::new(&"x".repeat(100))).is_ok());
        assert!(check_path(Path::new(&"x".repeat(101))).is_err());
    }
}