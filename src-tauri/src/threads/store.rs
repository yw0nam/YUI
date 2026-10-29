use super::model::{
    Answer, AnswerInput, AskUpdate, DeliveredAnswer, Entry, Role, Thread, ThreadState, Upsert,
    TEXT_MAX_CHARS,
};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

const ENTRY_LIMIT: usize = 50;
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

struct State {
    threads: HashMap<String, Thread>,
    pending: VecDeque<(String, Answer)>,
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
        self.pending.retain(|(id, _)| self.threads.contains_key(id));
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
    changed: Condvar,
    emit: Box<dyn Fn(&ThreadsSnapshot) + Send + Sync>,
    #[cfg(test)]
    wait_started: Mutex<Option<std::sync::Arc<std::sync::Barrier>>>,
}

impl ThreadStore {
    pub fn new(
        threads: Vec<Thread>,
        disk: DiskSink,
        emit: impl Fn(&ThreadsSnapshot) + Send + Sync + 'static,
    ) -> Self {
        Self {
            state: Mutex::new(State {
                threads: threads.into_iter().map(|t| (t.id.clone(), t)).collect(),
                pending: VecDeque::new(),
                revision: 0,
                disk,
            }),
            changed: Condvar::new(),
            emit: Box::new(emit),
            #[cfg(test)]
            wait_started: Mutex::new(None),
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
                ask: None,
                created_at: now,
                updated_at: now,
                answered_ask_ids: Default::default(),
            });
            thread.source = body.source;
            thread.title = body.title;
            thread.label = body.label;
            thread.state = body.state;
            thread.updated_at = now;
            thread
                .entries
                .extend(body.entries.into_iter().map(|e| Entry {
                    role: e.role,
                    text: e.text,
                    at: now,
                }));
            cap_entries(thread);
            match body.ask {
                AskUpdate::Keep => {}
                AskUpdate::Close => thread.ask = None,
                AskUpdate::Set(ask) => {
                    thread.ask = (!thread.answered_ask_ids.contains(&ask.ask_id)).then_some(ask);
                }
            }
            if thread.state != ThreadState::InputRequired {
                thread.ask = None;
            }
            state.changed(id, now)
        };
        self.changed.notify_all();
        (self.emit)(&snapshot);
        now
    }

    pub fn answer(&self, id: &str, answer: AnswerInput, now: u64) -> Result<(), AnswerError> {
        let snapshot = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            let thread = state
                .threads
                .get_mut(id)
                .ok_or(AnswerError("unknown thread"))?;
            let ask = thread.ask.as_ref().ok_or(AnswerError("ask is not open"))?;
            if ask.ask_id != answer.ask_id {
                return Err(AnswerError("ask_id does not match open ask"));
            }
            let choice = answer
                .choice
                .as_ref()
                .map(|id| {
                    ask.choices
                        .iter()
                        .find(|c| &c.id == id)
                        .ok_or(AnswerError("choice is not among the ask choices"))
                })
                .transpose()?;
            if answer.choice.is_none()
                && answer.text.as_ref().is_none_or(|t| t.is_empty())
                && answer.release != Some(true)
            {
                return Err(AnswerError(
                    "answer requires a choice, non-empty text, or release",
                ));
            }
            if answer.text.is_some() && !ask.text {
                return Err(AnswerError("ask does not accept text"));
            }
            if answer
                .text
                .as_ref()
                .is_some_and(|t| t.chars().count() > TEXT_MAX_CHARS)
            {
                return Err(AnswerError("answer text exceeds 16384 characters"));
            }
            let text = choice
                .map(|c| c.label.as_str())
                .into_iter()
                .chain(answer.text.as_deref().filter(|s| !s.is_empty()))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                thread.entries.push(Entry {
                    role: Role::User,
                    text,
                    at: now,
                });
            }
            cap_entries(thread);
            thread.ask = None;
            thread.state = ThreadState::Working;
            thread.updated_at = now;
            thread.answered_ask_ids.insert(answer.ask_id.clone());
            state.pending.push_back((
                id.into(),
                Answer {
                    input: answer,
                    at: now,
                },
            ));
            state.changed(id, now)
        };
        self.changed.notify_all();
        (self.emit)(&snapshot);
        Ok(())
    }

    pub fn wait_answer(&self, id: &str, ask_id: Option<&str>, timeout: Duration) -> WaitOutcome {
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        loop {
            let Some(thread) = state.threads.get(id) else {
                return WaitOutcome::Unknown;
            };
            let open = thread
                .ask
                .as_ref()
                .is_some_and(|a| Some(a.ask_id.as_str()) == ask_id);
            let pending = state.pending.iter().position(|(thread_id, answer)| {
                thread_id == id && ask_id.is_none_or(|ask| answer.input.ask_id == ask)
            });
            if let Some(index) = pending {
                return WaitOutcome::Answer(
                    state
                        .pending
                        .remove(index)
                        .expect("pending answer exists")
                        .1,
                );
            }
            if ask_id.is_some() && !open {
                return WaitOutcome::Gone;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return WaitOutcome::NoAnswer;
            }
            #[cfg(test)]
            if let Some(start) = self
                .wait_started
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take()
            {
                start.wait();
            }
            state = self
                .changed
                .wait_timeout(state, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    pub fn drain_answers(&self, source: &str) -> Vec<DeliveredAnswer> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let State {
            threads, pending, ..
        } = &mut *state;
        let (drained, kept): (Vec<_>, Vec<_>) =
            std::mem::take(pending).into_iter().partition(|(id, _)| {
                threads
                    .get(id)
                    .is_some_and(|thread| thread.source == source)
            });
        *pending = kept.into();
        drained
            .into_iter()
            .map(|(thread_id, answer)| DeliveredAnswer { thread_id, answer })
            .collect()
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
    fn answer() -> AnswerInput {
        AnswerInput {
            ask_id: "a".into(),
            choice: Some("yes".into()),
            text: Some("Please".into()),
            release: None,
        }
    }
    fn poll(s: &ThreadStore, ask: &str) -> WaitOutcome {
        s.wait_answer("t", Some(ask), Duration::ZERO)
    }

    #[test]
    fn any_ask_delivers_oldest_pending_once_and_never_gone() {
        let s = store();
        assert_eq!(
            s.wait_answer("t", None, Duration::ZERO),
            WaitOutcome::Unknown
        );
        s.upsert("t", input(), 1);
        assert_eq!(
            s.wait_answer("t", None, Duration::ZERO),
            WaitOutcome::NoAnswer
        );
        s.answer("t", answer(), 2).unwrap();
        let mut next = input();
        if let AskUpdate::Set(ref mut ask) = next.ask {
            ask.ask_id = "b".into();
        }
        s.upsert("t", next, 3);
        let mut b = answer();
        b.ask_id = "b".into();
        s.answer("t", b.clone(), 4).unwrap();
        for (input, at) in [(answer(), 2), (b, 4)] {
            assert_eq!(
                s.wait_answer("t", None, Duration::ZERO),
                WaitOutcome::Answer(Answer { input, at })
            );
        }
        assert_eq!(
            s.wait_answer("t", None, Duration::ZERO),
            WaitOutcome::NoAnswer
        );
    }

    #[test]
    fn sweep_delivers_only_the_named_source_once() {
        let s = store();
        let mut github = input();
        github.source = "github".into();
        s.upsert("t", input(), 1);
        s.upsert("pr1", github.clone(), 2);
        s.upsert("pr2", github, 3);
        s.answer("t", answer(), 4).unwrap();
        s.answer("pr1", answer(), 5).unwrap();
        s.answer("pr2", answer(), 6).unwrap();
        assert_eq!(
            s.drain_answers("github"),
            vec![
                DeliveredAnswer {
                    thread_id: "pr1".into(),
                    answer: Answer {
                        input: answer(),
                        at: 5
                    },
                },
                DeliveredAnswer {
                    thread_id: "pr2".into(),
                    answer: Answer {
                        input: answer(),
                        at: 6
                    },
                },
            ]
        );
        assert_eq!(s.drain_answers("github"), Vec::new());
        assert_eq!(
            s.drain_answers("codex"),
            vec![DeliveredAnswer {
                thread_id: "t".into(),
                answer: Answer {
                    input: answer(),
                    at: 4
                },
            }]
        );
    }

    #[test]
    fn sweep_and_long_poll_deliver_each_answer_once() {
        let s = store();
        s.upsert("t", input(), 1);
        s.answer("t", answer(), 2).unwrap();
        assert_eq!(
            s.drain_answers("codex"),
            vec![DeliveredAnswer {
                thread_id: "t".into(),
                answer: Answer {
                    input: answer(),
                    at: 2
                },
            }]
        );
        assert_eq!(
            s.wait_answer("t", None, Duration::ZERO),
            WaitOutcome::NoAnswer
        );
        let s = store();
        s.upsert("t", input(), 1);
        s.answer("t", answer(), 2).unwrap();
        assert!(matches!(
            s.wait_answer("t", None, Duration::ZERO),
            WaitOutcome::Answer(_)
        ));
        assert_eq!(s.drain_answers("codex"), Vec::new());
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
        let expected = Answer {
            input: answer(),
            at: 2,
        };
        assert_eq!(poll(&s, "a"), WaitOutcome::Answer(expected));
        assert_eq!(poll(&s, "a"), WaitOutcome::Gone);
        let mut next = input();
        if let AskUpdate::Set(ref mut ask) = next.ask {
            ask.ask_id = "b".into();
        }
        s.upsert("t", next, 4);
        let a = AnswerInput {
            ask_id: "b".into(),
            choice: None,
            text: None,
            release: Some(true),
        };
        assert_eq!(s.answer("t", a, 5), Ok(()));
        assert_eq!(s.snapshot().threads[0].entries.len(), 1);
        assert!(matches!(
            poll(&s, "b"),
            WaitOutcome::Answer(Answer {
                input: AnswerInput {
                    release: Some(true),
                    ..
                },
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
        *s.wait_started.lock().unwrap() = Some(start.clone());
        let worker =
            std::thread::spawn(move || other.wait_answer("t", Some("a"), Duration::from_secs(2)));
        start.wait();
        let elapsed = Instant::now();
        assert_eq!(s.answer("t", answer(), 2), Ok(()));
        let expected = Answer {
            input: answer(),
            at: 2,
        };
        assert_eq!(worker.join().unwrap(), WaitOutcome::Answer(expected));
        assert!(
            elapsed.elapsed() < Duration::from_millis(500),
            "answer wakes before the 2 s deadline"
        );
    }

    #[test]
    fn open_ask_times_out_at_deadline() {
        let s = store();
        s.upsert("t", input(), 1);
        let start = Instant::now();
        assert_eq!(
            s.wait_answer("t", Some("a"), Duration::from_millis(30)),
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
    fn expiry_removes_threads_and_wakes_waiters() {
        let s = Arc::new(store());
        s.upsert("t", input(), 1);
        let other = s.clone();
        let start = Arc::new(Barrier::new(2));
        *s.wait_started.lock().unwrap() = Some(start.clone());
        let waiter =
            std::thread::spawn(move || other.wait_answer("t", Some("a"), Duration::from_secs(2)));
        start.wait();
        let elapsed = Instant::now();
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
        assert!(
            elapsed.elapsed() < Duration::from_millis(500),
            "expiry wakes before the 2 s deadline"
        );
    }

    #[test]
    fn answered_ask_stays_closed_pending_delivered_and_replayed() {
        for delivered in [false, true] {
            let s = store();
            s.upsert("t", input(), 1);
            s.answer("t", answer(), 2).unwrap();
            if delivered {
                assert!(matches!(poll(&s, "a"), WaitOutcome::Answer(_)));
            }
            s.upsert("t", input(), 3);
            assert_eq!(
                s.snapshot().threads[0].ask,
                None,
                "answered ask stays closed (delivered={delivered})"
            );
            if !delivered {
                assert!(matches!(poll(&s, "a"), WaitOutcome::Answer(_)));
            }
            assert_eq!(poll(&s, "a"), WaitOutcome::Gone);
            let saved = serde_json::to_string(&s.snapshot().threads).unwrap();
            let restored = ThreadStore::new(
                serde_json::from_str(&saved).unwrap(),
                Box::new(|_| Ok(())),
                |_| {},
            );
            restored.upsert("t", input(), 4);
            assert_eq!(
                restored.snapshot().threads[0].ask,
                None,
                "answered ask stays closed after replay"
            );
            let mut next = input();
            if let AskUpdate::Set(ref mut a) = next.ask {
                a.ask_id = "b".into();
            }
            restored.upsert("t", next, 5);
            assert_eq!(poll(&restored, "b"), WaitOutcome::NoAnswer);
        }
    }

    #[test]
    fn poisoned_store_still_accepts_changes_and_answers() {
        let s = store();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = s.state.lock().unwrap();
            panic!("poison state");
        }));
        assert_eq!(s.upsert("t", input(), 1), 1);
        assert_eq!(s.snapshot().revision, 1);
        assert_eq!(
            s.wait_answer("t", Some("a"), Duration::from_millis(1)),
            WaitOutcome::NoAnswer
        );
        assert_eq!(s.answer("t", answer(), 2), Ok(()));
        assert!(matches!(poll(&s, "a"), WaitOutcome::Answer(_)));
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
