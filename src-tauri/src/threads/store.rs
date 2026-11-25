use super::model::{Entry, Thread, ThreadState, Upsert};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

const ENTRY_LIMIT: usize = 50;
const THREAD_LIMIT: usize = 200;
type DiskSink = Box<dyn FnMut(&Thread) -> std::io::Result<()> + Send>;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ThreadsSnapshot {
    pub revision: u64,
    pub threads: Vec<Thread>,
}

struct State {
    threads: HashMap<String, Thread>,
    revision: u64,
    disk: DiskSink,
}

impl State {
    fn snapshot(&self) -> ThreadsSnapshot {
        let mut threads: Vec<_> = self.threads.values().cloned().collect();
        threads.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        ThreadsSnapshot {
            revision: self.revision,
            threads,
        }
    }

    fn changed(&mut self, id: &str, now: u64) -> ThreadsSnapshot {
        self.threads.retain(|_, thread| {
            thread.updated_at
                >= now.saturating_sub(crate::log_rotation::RETENTION.whole_milliseconds() as u64)
        });
        self.cap_threads(Some(id));
        self.record(id)
    }

    fn cap_threads(&mut self, recorded_id: Option<&str>) {
        let excess = self.threads.len().saturating_sub(THREAD_LIMIT);
        if excess == 0 {
            return;
        }
        let mut eligible: Vec<_> = self
            .threads
            .values()
            .filter(|thread| {
                thread.state != ThreadState::InputRequired
                    && Some(thread.id.as_str()) != recorded_id
            })
            .map(|thread| (thread.updated_at, thread.id.clone()))
            .collect();
        eligible.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)));
        for (_, id) in eligible.into_iter().take(excess) {
            self.threads.remove(&id);
        }
    }

    fn record(&mut self, id: &str) -> ThreadsSnapshot {
        self.revision += 1;
        let thread = &self.threads[id];
        if let Err(error) = (self.disk)(thread) {
            log::warn!("threads_append_failed id={id} error={error}");
        }
        self.snapshot()
    }
}

pub struct ThreadStore {
    state: Mutex<State>,
    emit: Box<dyn Fn(&ThreadsSnapshot) + Send + Sync>,
}

impl ThreadStore {
    pub fn new(
        threads: Vec<Thread>,
        disk: DiskSink,
        emit: impl Fn(&ThreadsSnapshot) + Send + Sync + 'static,
    ) -> Self {
        let mut state = State {
            threads: threads.into_iter().map(|t| (t.id.clone(), t)).collect(),
            revision: 0,
            disk,
        };
        state.cap_threads(None);
        Self {
            state: Mutex::new(state),
            emit: Box::new(emit),
        }
    }

    pub fn upsert(&self, id: &str, body: Upsert, now: u64) -> u64 {
        let snapshot = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            let thread = state.threads.entry(id.into()).or_insert_with(|| Thread {
                id: id.into(),
                source: String::new(),
                title: String::new(),
                label: None,
                state: ThreadState::Working,
                entries: vec![],
                created_at: now,
                updated_at: now,
                read: false,
                entry_count: 0,
            });
            thread.source = body.source;
            thread.title = body.title;
            thread.label = body.label;
            thread.state = body.state;
            thread.updated_at = now;
            thread.read = false;
            thread.entry_count += body.entries.len() as u64;
            thread
                .entries
                .extend(body.entries.into_iter().map(|e| Entry {
                    role: e.role,
                    text: e.text,
                    at: now,
                }));
            cap_entries(thread);
            state.changed(id, now)
        };
        (self.emit)(&snapshot);
        now
    }

    pub fn read(&self, id: &str) -> Result<(), &'static str> {
        let snapshot = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            let thread = state.threads.get_mut(id).ok_or("unknown thread")?;
            if thread.read {
                return Ok(());
            }
            thread.read = true;
            state.record(id)
        };
        (self.emit)(&snapshot);
        Ok(())
    }

    pub fn snapshot(&self) -> ThreadsSnapshot {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .snapshot()
    }
}

fn cap_entries(thread: &mut Thread) {
    let excess = thread.entries.len().saturating_sub(ENTRY_LIMIT);
    thread.entries.drain(..excess);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::threads::model::{tests::body, InputEntry, Role, ThreadState};
    use std::sync::{Arc, Mutex};

    fn input() -> Upsert {
        Upsert {
            source: "codex".into(),
            title: "Build".into(),
            label: None,
            state: ThreadState::InputRequired,
            entries: vec![],
        }
    }
    fn store() -> ThreadStore {
        ThreadStore::new(vec![], Box::new(|_| Ok(())), |_| {})
    }

    #[test]
    fn completed_threads_evict_the_five_oldest_past_200() {
        let s = store();
        for i in 0..205 {
            let mut body = input();
            body.state = ThreadState::Completed;
            s.upsert(&format!("t{i:03}"), body, i);
        }
        let snapshot = s.snapshot();
        assert_eq!(snapshot.threads.len(), 200);
        assert_eq!(snapshot.threads.last().unwrap().id, "t005");
    }

    #[test]
    fn input_required_and_just_recorded_threads_survive_count_eviction() {
        for completed_last in [false, true] {
            let s = store();
            for i in 0..201 {
                let mut body = input();
                if completed_last && i == 200 {
                    body.state = ThreadState::Completed;
                }
                s.upsert(&format!("t{i:03}"), body, i);
            }
            assert_eq!(
                s.snapshot().threads.len(),
                201,
                "completed_last={completed_last}"
            );
        }
    }

    #[test]
    fn loaded_threads_keep_the_newest_200_with_id_ties() {
        let seed = store();
        let mut body = input();
        body.state = ThreadState::Completed;
        seed.upsert("seed", body, 1);
        let template = seed.snapshot().threads.remove(0);
        let loaded = (0..251)
            .rev()
            .map(|i| {
                let mut thread = template.clone();
                thread.id = format!("t{i:03}");
                thread.updated_at = (i / 2) as u64;
                thread
            })
            .collect();
        let s = ThreadStore::new(loaded, Box::new(|_| Ok(())), |_| {});
        let snapshot = s.snapshot();
        assert_eq!(snapshot.threads.len(), 200);
        assert_eq!(snapshot.threads.first().unwrap().id, "t250");
        assert_eq!(snapshot.threads.last().unwrap().id, "t050");
        let mut ids: Vec<_> = snapshot
            .threads
            .iter()
            .map(|thread| thread.id.clone())
            .collect();
        ids.sort();
        assert_eq!(
            ids,
            std::iter::once(50)
                .chain(52..251)
                .map(|i| format!("t{i:03}"))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn entries_append_stamp_and_cap() {
        let s = store();
        for batch in 0..3 {
            let mut b = input();
            b.entries = (0..20)
                .map(|i| InputEntry {
                    role: Role::Agent,
                    text: format!("{}", batch * 20 + i),
                })
                .collect();
            assert_eq!(s.upsert("t", b, 100 + batch), 100 + batch);
        }
        let snapshot = s.snapshot();
        let t = &snapshot.threads[0];
        assert_eq!(t.created_at, 100);
        assert_eq!(t.updated_at, 102);
        assert_eq!(t.entries.len(), 50);
        assert_eq!(t.entries[0].text, "10");
        assert_eq!(t.entries[49].at, 102);
        assert_eq!(t.entry_count, 60);
    }

    #[test]
    fn revisions_and_snapshot_order_reach_emit_after_disk() {
        let disk = Arc::new(Mutex::new(Vec::new()));
        let recorded = disk.clone();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let emitted = seen.clone();
        let written = disk.clone();
        let s = ThreadStore::new(
            vec![],
            Box::new(move |t| {
                recorded.lock().unwrap().push(t.clone());
                Ok(())
            }),
            move |snapshot| {
                assert!(written.lock().unwrap().len() >= snapshot.revision as usize);
                emitted.lock().unwrap().push(snapshot.clone());
            },
        );
        s.upsert("old", input(), 1);
        s.upsert("new", input(), 2);
        s.upsert("old", input(), 3);
        assert_eq!(
            seen.lock()
                .unwrap()
                .iter()
                .map(|s| s.revision)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            s.snapshot()
                .threads
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["old", "new"]
        );
    }

    #[test]
    fn expiry_removes_threads() {
        let s = store();
        s.upsert("t", input(), 1);
        s.upsert("fresh", input(), 1_209_600_002);
        assert_eq!(
            s.snapshot()
                .threads
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["fresh"]
        );
    }

    #[test]
    fn read_marks_a_thread_in_place_survives_a_restart_and_clears_on_upsert() {
        let saved = Arc::new(Mutex::new(vec![]));
        let sink = saved.clone();
        let s = ThreadStore::new(
            vec![],
            Box::new(move |t| {
                sink.lock().unwrap().push(t.clone());
                Ok(())
            }),
            |_| {},
        );
        s.upsert("t", input(), 1);
        assert_eq!(s.read("t"), Ok(()));
        let snap = s.snapshot();
        assert_eq!(snap.revision, 2);
        assert!(snap.threads[0].read);
        assert_eq!(snap.threads[0].updated_at, 1);
        assert!(saved.lock().unwrap().last().unwrap().read);
        assert_eq!(s.read("t"), Ok(()));
        assert_eq!(s.snapshot().revision, 2);
        assert_eq!(s.read("nope"), Err("unknown thread"));

        let restored = ThreadStore::new(
            serde_json::from_str(&serde_json::to_string(&s.snapshot().threads).unwrap()).unwrap(),
            Box::new(|_| Ok(())),
            |_| {},
        );
        assert!(restored.snapshot().threads[0].read);
        restored.upsert("t", input(), 4);
        assert!(!restored.snapshot().threads[0].read);
    }

    #[test]
    fn poisoned_store_still_accepts_changes() {
        let s = store();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = s.state.lock().unwrap();
            panic!("poison state");
        }));
        assert_eq!(s.upsert("t", input(), 1), 1);
        assert_eq!(s.snapshot().revision, 1);
        assert_eq!(s.read("t"), Ok(()));
        assert_eq!(s.snapshot().revision, 2);
    }

    #[test]
    fn an_ask_key_in_a_put_is_never_stored() {
        let s = store();
        let mut value = body();
        value["ask"] = serde_json::json!({"ask_id":"a","prompt":"Allow?","text":true});
        s.upsert(
            "t",
            super::super::model::parse_upsert(&value.to_string()).unwrap(),
            1,
        );
        let stored = serde_json::to_value(&s.snapshot().threads[0]).unwrap();
        assert_eq!(stored.get("ask"), None);
    }

    #[test]
    fn failed_disk_append_leaves_change_applied() {
        let s = ThreadStore::new(
            vec![],
            Box::new(|_| Err(std::io::Error::other("disk full"))),
            |_| {},
        );
        assert_eq!(s.upsert("t", input(), 7), 7);
        assert_eq!(s.snapshot().revision, 1);
        assert_eq!(s.snapshot().threads[0].updated_at, 7);
    }
}
