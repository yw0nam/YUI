//! The files last dropped onto each settings window, recorded from the native drag-drop event.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// The files last dropped onto each settings window, kept until `import_dropped_card` takes them.
#[derive(Default)]
pub struct DroppedFiles(Mutex<HashMap<String, Vec<PathBuf>>>);

impl DroppedFiles {
    pub fn record(&self, _label: &str, _paths: Vec<PathBuf>) {}

    pub fn clear(&self, _label: &str) {}

    pub fn take(&self, _label: &str) -> Vec<PathBuf> {
        Vec::new()
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
