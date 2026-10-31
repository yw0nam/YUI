//! Starts ego lite outside the host's job on Windows, so stopping the server leaves the user's browser running.

use std::path::Path;
#[cfg(windows)]
use std::{process::Stdio, time::Duration};
#[cfg(windows)]
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

/// A cold start measured 1.3 to 1.8 s; the wait keeps the 28 s backstop inside the host's 32 s call wait.
#[cfg(windows)]
const BOOT_WAIT: Duration = Duration::from_secs(3);

#[cfg(not(windows))]
pub async fn start_ego(_bin: &Path) {}

#[cfg(windows)]
pub async fn start_ego(bin: &Path) {
    let child = Command::new(bin)
        .args(["nodejs", "-e", "0"])
        .creation_flags(CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(e) => return eprintln!("browser_boot_failed error={e}"),
    };
    match tokio::time::timeout(BOOT_WAIT, child.wait()).await {
        Ok(Ok(status)) if status.success() => {}
        Ok(Ok(status)) => eprintln!("browser_boot_failed error=exit {status}"),
        Ok(Err(e)) => eprintln!("browser_boot_failed error={e}"),
        Err(_) => eprintln!("browser_boot_failed error=timed out"),
    }
}
