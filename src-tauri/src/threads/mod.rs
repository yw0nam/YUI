pub mod commands;
mod disk;
pub mod model;
pub mod store;

use crate::os_event_watcher::epoch_ms;
use std::sync::Arc;
use tauri::{App, Emitter, Manager};
use time::UtcOffset;

pub fn setup(app: &App, offset: UtcOffset) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?.join("threads");
    let threads = disk::replay(&dir, epoch_ms() as u64);
    let mut disk = disk::Disk::new(dir, offset);
    let handle = app.handle().clone();
    app.manage(Arc::new(store::ThreadStore::new(
        threads,
        Box::new(move |thread| disk.append(thread)),
        move |snapshot| {
            if let Err(error) = handle.emit("threads-snapshot", snapshot) {
                log::warn!("threads_snapshot_emit_failed error={error}");
            }
        },
    )));
    Ok(())
}
