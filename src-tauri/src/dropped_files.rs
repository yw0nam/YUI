//! The files last dropped onto each settings window, recorded from the native drag-drop event.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use tauri::{DragDropEvent, Manager, Window, WindowEvent};

/// The files last dropped onto each settings window, kept until `import_dropped_card` takes them.
#[derive(Default)]
pub struct DroppedFiles(Mutex<HashMap<String, Vec<PathBuf>>>);

impl DroppedFiles {
    /// Replaces that window's entry.
    pub fn record(&self, label: &str, paths: Vec<PathBuf>) {
        self.entries().insert(label.to_string(), paths);
    }

    pub fn clear(&self, label: &str) {
        self.entries().remove(label);
    }

    /// Removes and returns that window's entry; empty when none.
    pub fn take(&self, label: &str) -> Vec<PathBuf> {
        self.entries().remove(label).unwrap_or_default()
    }

    fn entries(&self) -> MutexGuard<'_, HashMap<String, Vec<PathBuf>>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Records a drop onto a settings window and forgets it when a new drag enters or the window closes.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let label = window.label();
    if label != "settings" && !label.starts_with("settings-") {
        return;
    }
    let Some(files) = window.try_state::<DroppedFiles>() else {
        return;
    };
    match event {
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            log::debug!("card_drop_recorded count={}", paths.len());
            files.record(label, paths.clone());
        }
        WindowEvent::DragDrop(DragDropEvent::Enter { .. }) | WindowEvent::Destroyed => {
            files.clear(label)
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn a_drop_is_taken_once() {
        let files = DroppedFiles::default();
        files.record("settings", paths(&["a/Mio.yui"]));

        assert_eq!(files.take("settings"), paths(&["a/Mio.yui"]));
        assert_eq!(files.take("settings"), paths(&[]));
    }

    #[test]
    fn a_new_drop_replaces_the_last_and_clear_forgets_it() {
        let files = DroppedFiles::default();
        files.record("settings", paths(&["a.png"]));
        files.record("settings", paths(&["b.json"]));
        assert_eq!(files.take("settings"), paths(&["b.json"]));

        files.record("settings", paths(&["c.yui"]));
        files.clear("settings");
        assert_eq!(files.take("settings"), paths(&[]));
    }

    #[test]
    fn each_settings_window_keeps_its_own_drop() {
        let files = DroppedFiles::default();
        files.record("settings", paths(&["a.png"]));
        files.record("settings-2", paths(&["b.png"]));
        files.clear("settings");

        assert_eq!(files.take("settings-2"), paths(&["b.png"]));
    }
}
