//! Process facts the webview reads.

use std::sync::atomic::{AtomicU64, Ordering};
use tauri::command;

static STARTED_AT_MS: AtomicU64 = AtomicU64::new(0);

/// Record the process start epoch ms; a later call never moves it.
pub fn record_started_at() {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    STARTED_AT_MS
        .compare_exchange(0, now_ms, Ordering::Relaxed, Ordering::Relaxed)
        .ok();
}

/// Epoch ms recorded once at process setup.
#[command]
pub fn app_started_at() -> u64 {
    STARTED_AT_MS.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_started_at_is_stable_across_calls() {
        record_started_at();
        let a = app_started_at();
        std::thread::sleep(std::time::Duration::from_millis(2));
        record_started_at();
        assert_eq!(app_started_at(), a);
    }
}
