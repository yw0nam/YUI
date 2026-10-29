use super::model::{Answer, Thread, Upsert};
use serde::Serialize;
use std::time::Duration;

type DiskSink = Box<dyn FnMut(&Thread) -> std::io::Result<()> + Send>;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ThreadsSnapshot {
    pub revision: u64,
    pub threads: Vec<Thread>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WaitOutcome {
    Answer(Answer),
    NoAnswer,
    Gone,
    Unknown,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AnswerError(pub &'static str);

pub struct ThreadStore;
impl ThreadStore {
    pub fn new(
        _threads: Vec<Thread>,
        _disk: DiskSink,
        _emit: impl Fn(&ThreadsSnapshot) + Send + Sync + 'static,
    ) -> Self {
        Self
    }
    pub fn upsert(&self, _id: &str, _body: Upsert, _now: u64) -> u64 {
        0
    }
    pub fn answer(&self, _id: &str, _answer: Answer, _now: u64) -> Result<(), AnswerError> {
        Err(AnswerError("unknown thread"))
    }
    pub fn wait_answer(&self, _id: &str, _ask_id: &str, _timeout: Duration) -> WaitOutcome {
        WaitOutcome::Unknown
    }
    pub fn snapshot(&self) -> ThreadsSnapshot {
        ThreadsSnapshot {
            revision: 0,
            threads: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::threads::model::{tests::body, AskUpdate, InputEntry, Role, ThreadState};
    use std::sync::{Arc, Barrier, Mutex};
    use std::time::Instant;

    fn input() -> Upsert {
        Upsert {
            source: "codex".into(),
            title: "Build".into(),
            label: None,
            state: ThreadState::InputRequired,
            entries: vec![],
            ask: AskUpdate::Set(serde_json::from_value(body()["ask"].clone()).unwrap()),
        }
    }
    fn store() -> ThreadStore {
        ThreadStore::new(vec![], Box::new(|_| Ok(())), |_| {})
    }
    fn answer() -> Answer {
        Answer {
            ask_id: "a".into(),
            choice: Some("yes".into()),
            text: Some("Please".into()),
            release: None,
            at: 0,
        }
    }
    fn poll(s: &ThreadStore, ask: &str) -> WaitOutcome {
        s.wait_answer("t", ask, Duration::ZERO)
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
    }

    #[test]
    fn ask_replace_keep_null_and_state_close() {
        let s = store();
        s.upsert("t", input(), 1);
        let mut keep = input();
        keep.ask = AskUpdate::Keep;
        s.upsert("t", keep, 2);
        assert_eq!(poll(&s, "a"), WaitOutcome::NoAnswer);
        let mut b = input();
        if let AskUpdate::Set(ref mut a) = b.ask {
            a.ask_id = "b".into();
        }
        s.upsert("t", b, 3);
        assert_eq!(poll(&s, "a"), WaitOutcome::Gone);
        assert_eq!(poll(&s, "b"), WaitOutcome::NoAnswer);
        let mut b = input();
        b.ask = AskUpdate::Close;
        s.upsert("t", b, 4);
        assert_eq!(poll(&s, "b"), WaitOutcome::Gone);
        for state in [
            ThreadState::Working,
            ThreadState::Completed,
            ThreadState::Failed,
        ] {
            s.upsert("t", input(), 5);
            let mut b = input();
            b.state = state;
            s.upsert("t", b, 6);
            assert_eq!(poll(&s, "a"), WaitOutcome::Gone);
        }
    }

    #[test]
    fn validates_answers_without_mutating() {
        for (case, message) in [
            ("unknown", "unknown thread"),
            ("closed", "ask is not open"),
            ("mismatch", "ask_id does not match open ask"),
            ("choice", "choice is not among the ask choices"),
            (
                "empty",
                "answer requires a choice, non-empty text, or release",
            ),
            ("text-disabled", "ask does not accept text"),
            ("long", "answer text exceeds 16384 characters"),
        ] {
            let s = store();
            if case != "unknown" {
                s.upsert("t", input(), 1);
            }
            if case == "closed" {
                let mut b = input();
                b.state = ThreadState::Working;
                s.upsert("t", b, 2);
            }
            if case == "text-disabled" {
                let mut b = input();
                if let AskUpdate::Set(ref mut a) = b.ask {
                    a.text = false;
                }
                s.upsert("t", b, 2);
            }
            let mut a = answer();
            match case {
                "mismatch" => a.ask_id = "b".into(),
                "choice" => a.choice = Some("no".into()),
                "empty" => {
                    a.choice = None;
                    a.text = Some("".into());
                    a.release = Some(false);
                }
                "long" => a.text = Some("x".repeat(16385)),
                _ => {}
            }
            let before = s.snapshot();
            assert_eq!(s.answer("t", a, 3), Err(AnswerError(message)), "{case}");
            assert_eq!(s.snapshot(), before);
        }
    }

    #[test]
    fn delivers_once_keeps_pending_and_records_user_entry() {
        let s = store();
        s.upsert("t", input(), 1);
        assert_eq!(s.answer("t", answer(), 2), Ok(()));
        let t = s.snapshot().threads.remove(0);
        assert_eq!(t.state, ThreadState::Working);
        assert_eq!(t.ask, None);
        assert_eq!(t.entries[0].text, "Allow\nPlease");
        assert_eq!(t.entries[0].role, Role::User);
        assert_eq!(t.entries[0].at, 2);
        let mut same = input();
        same.state = ThreadState::Completed;
        s.upsert("t", same, 3);
        let mut expected = answer();
        expected.at = 2;
        assert_eq!(poll(&s, "a"), WaitOutcome::Answer(expected));
        assert_eq!(poll(&s, "a"), WaitOutcome::Gone);
        s.upsert("t", input(), 4);
        let a = Answer {
            choice: None,
            text: None,
            release: Some(true),
            ..answer()
        };
        assert_eq!(s.answer("t", a, 5), Ok(()));
        assert_eq!(s.snapshot().threads[0].entries.len(), 1);
        assert!(matches!(
            poll(&s, "a"),
            WaitOutcome::Answer(Answer {
                release: Some(true),
                ..
            })
        ));
    }

    #[test]
    fn waiter_wakes_on_answer() {
        let s = Arc::new(store());
        s.upsert("t", input(), 1);
        let other = s.clone();
        let start = Arc::new(Barrier::new(2));
        let ready = start.clone();
        let worker = std::thread::spawn(move || {
            ready.wait();
            other.wait_answer("t", "a", Duration::from_secs(2))
        });
        start.wait();
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(s.answer("t", answer(), 2), Ok(()));
        let mut expected = answer();
        expected.at = 2;
        assert_eq!(worker.join().unwrap(), WaitOutcome::Answer(expected));
    }

    #[test]
    fn open_ask_times_out_at_deadline() {
        let s = store();
        s.upsert("t", input(), 1);
        let start = Instant::now();
        assert_eq!(
            s.wait_answer("t", "a", Duration::from_millis(30)),
            WaitOutcome::NoAnswer
        );
        assert!(start.elapsed() >= Duration::from_millis(30));
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
        assert_eq!(s.answer("old", answer(), 3), Ok(()));
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
    fn concurrent_disk_order_replays_latest_state() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let s = Arc::new(ThreadStore::new(
            vec![],
            Box::new(move |t| {
                sink.lock().unwrap().push(serde_json::to_string(t).unwrap());
                Ok(())
            }),
            |_| {},
        ));
        let start = Arc::new(Barrier::new(3));
        let mut workers = vec![];
        for title in ["one", "two"] {
            let s = s.clone();
            let start = start.clone();
            workers.push(std::thread::spawn(move || {
                start.wait();
                let mut b = input();
                b.title = title.into();
                s.upsert("t", b, 1);
            }));
        }
        start.wait();
        for w in workers {
            w.join().unwrap();
        }
        assert_eq!(s.snapshot().revision, 2);
        let replayed: Thread = serde_json::from_str(lines.lock().unwrap().last().unwrap()).unwrap();
        assert_eq!(replayed, s.snapshot().threads[0]);
    }

    #[test]
    fn expiry_removes_threads_and_wakes_waiters() {
        let s = Arc::new(store());
        s.upsert("t", input(), 1);
        let other = s.clone();
        let waiter =
            std::thread::spawn(move || other.wait_answer("t", "a", Duration::from_secs(2)));
        s.upsert("fresh", input(), 1_209_600_002);
        assert_eq!(
            s.snapshot()
                .threads
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["fresh"]
        );
        assert_eq!(waiter.join().unwrap(), WaitOutcome::Unknown);
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
