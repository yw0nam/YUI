use serde::Serialize;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

pub const TURN_STOPPED: &str = "error: turn stopped";
const NO_ANSWER: &str = "denied: no answer in 60 s";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TerminalOwner {
    User,
    Preset { preset_id: String },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pub id: String,
    pub owner: TerminalOwner,
    pub title: String,
    pub opened_at: u64,
    pub exit_code: Option<u32>,
    pub access: Option<String>,
    pub last_command: Option<String>,
}

impl Terminal {
    pub fn status(&self) -> String {
        self.exit_code
            .map_or_else(|| "running".into(), |code| format!("exited {code}"))
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccessKind {
    Read,
    Write,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequest {
    pub id: String,
    pub terminal_id: String,
    pub preset_id: String,
    pub kind: AccessKind,
    pub text: Option<String>,
    pub deadline: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct TerminalSnapshot {
    pub revision: u64,
    pub terminals: Vec<Terminal>,
    pub requests: Vec<AccessRequest>,
}

pub struct TerminalStore<P> {
    _p: std::marker::PhantomData<P>,
    _m: Mutex<()>,
    _c: Condvar,
    _i: Option<Instant>,
}

impl<P> TerminalStore<P> {
    pub fn new(_: Duration, _: impl Fn(&TerminalSnapshot) + Send + Sync + 'static) -> Self {
        Self {
            _p: Default::default(),
            _m: Mutex::new(()),
            _c: Condvar::new(),
            _i: None,
        }
    }
    pub fn snapshot(&self) -> TerminalSnapshot {
        TerminalSnapshot {
            revision: 0,
            terminals: vec![],
            requests: vec![],
        }
    }
    pub fn size(&self) -> (u16, u16) {
        (120, 32)
    }
    pub fn add(&self, owner: TerminalOwner, title: String, _: Arc<P>, now: u64) -> Terminal {
        Terminal {
            id: "t1".into(),
            owner,
            title,
            opened_at: now,
            exit_code: None,
            access: None,
            last_command: None,
        }
    }
    pub fn get(&self, id: &str) -> Result<Arc<P>, String> {
        Err(id.into())
    }
    pub fn close(&self, id: &str, _: Option<&str>) -> Result<Arc<P>, String> {
        Err(id.into())
    }
    pub fn take_back(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn answer(&self, _: &str, _: bool) -> Result<(), String> {
        Ok(())
    }
    pub fn cancel(&self, _: &str) {}
    pub fn gate(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: AccessKind,
        _: Option<&str>,
        _: u64,
    ) -> Result<(Arc<P>, Terminal), String> {
        Err(String::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread::{self, JoinHandle};

    type Store = Arc<TerminalStore<()>>;
    type Call = JoinHandle<Result<Option<String>, String>>;

    fn store(limit: Duration) -> (Store, mpsc::Receiver<TerminalSnapshot>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let store = TerminalStore::new(limit, move |s: &TerminalSnapshot| {
            let _ = tx.lock().unwrap().send(s.clone());
        });
        (Arc::new(store), rx)
    }

    fn preset(id: &str) -> TerminalOwner {
        TerminalOwner::Preset {
            preset_id: id.into(),
        }
    }

    /// A tool call on its own thread; it returns the terminal's last command once it passes.
    fn call(
        store: &Store,
        call_id: &str,
        preset_id: &str,
        kind: AccessKind,
        text: Option<&str>,
    ) -> Call {
        let (store, call_id, preset_id) = (store.clone(), call_id.to_owned(), preset_id.to_owned());
        let text = text.map(str::to_owned);
        thread::spawn(move || {
            store
                .gate(&call_id, &preset_id, "t1", kind, text.as_deref(), 1_000)
                .map(|(_, t)| t.last_command)
        })
    }

    fn next_request(rx: &mpsc::Receiver<TerminalSnapshot>) -> AccessRequest {
        loop {
            let snapshot = rx
                .recv_timeout(Duration::from_secs(5))
                .expect("a request appears");
            if let Some(request) = snapshot.requests.last() {
                return request.clone();
            }
        }
    }

    #[test]
    fn a_read_without_access_waits_for_allow_which_gives_access() {
        let (s, rx) = store(Duration::from_secs(60));
        s.add(TerminalOwner::User, "~".into(), Arc::new(()), 1);
        let read = call(&s, "c1", "yui", AccessKind::Read, None);
        assert_eq!(
            next_request(&rx),
            AccessRequest {
                id: "r1".into(),
                terminal_id: "t1".into(),
                preset_id: "yui".into(),
                kind: AccessKind::Read,
                text: None,
                deadline: 61_000,
            }
        );
        s.answer("r1", true).unwrap();
        assert_eq!(read.join().unwrap(), Ok(None));
        let snapshot = s.snapshot();
        assert_eq!(snapshot.terminals[0].access.as_deref(), Some("yui"));
        assert_eq!(snapshot.requests, vec![]);
    }

    #[test]
    fn deny_cancel_and_the_deadline_refuse_the_waiting_call() {
        for (limit, end, expected) in [
            (60, Some(true), "denied"),
            (60, Some(false), TURN_STOPPED),
            (0, None, "denied: no answer in 60 s"),
        ] {
            let (s, rx) = store(Duration::from_secs(limit));
            s.add(TerminalOwner::User, "~".into(), Arc::new(()), 1);
            let read = call(&s, "c1", "yui", AccessKind::Read, None);
            let request = next_request(&rx);
            match end {
                Some(true) => s.answer(&request.id, false).unwrap(),
                Some(false) => s.cancel("c1"),
                None => {}
            }
            assert_eq!(read.join().unwrap(), Err(expected.into()));
            let snapshot = s.snapshot();
            assert_eq!(snapshot.terminals[0].access, None);
            assert_eq!(snapshot.requests, vec![]);
        }
    }

    #[test]
    fn allowing_another_preset_moves_access_to_it() {
        let (s, rx) = store(Duration::from_secs(60));
        s.add(TerminalOwner::User, "~".into(), Arc::new(()), 1);
        let a = call(&s, "c1", "a", AccessKind::Read, None);
        s.answer(&next_request(&rx).id, true).unwrap();
        a.join().unwrap().unwrap();
        let b = call(&s, "c2", "b", AccessKind::Write, Some("ls"));
        s.answer(&next_request(&rx).id, true).unwrap();
        b.join().unwrap().unwrap();
        assert_eq!(s.snapshot().terminals[0].access.as_deref(), Some("b"));
    }

    #[test]
    fn take_back_ends_access_and_the_next_call_asks_again() {
        let (s, rx) = store(Duration::from_secs(60));
        s.add(TerminalOwner::User, "~".into(), Arc::new(()), 1);
        let read = call(&s, "c1", "yui", AccessKind::Read, None);
        s.answer(&next_request(&rx).id, true).unwrap();
        read.join().unwrap().unwrap();
        let write = call(&s, "c2", "yui", AccessKind::Write, Some("  ls -la \nmore"));
        assert_eq!(write.join().unwrap(), Ok(Some("ls -la".into())));
        s.take_back("t1").unwrap();
        assert_eq!(s.snapshot().terminals[0].access, None);
        let again = call(&s, "c3", "yui", AccessKind::Read, None);
        assert_eq!(next_request(&rx).id, "r2");
        s.cancel("c3");
        assert_eq!(again.join().unwrap(), Err(TURN_STOPPED.into()));
    }

    #[test]
    fn a_preset_closes_only_the_terminals_it_opened() {
        let (s, _rx) = store(Duration::from_secs(60));
        s.add(TerminalOwner::User, "~".into(), Arc::new(()), 1);
        s.add(preset("yui"), "~".into(), Arc::new(()), 1);
        assert_eq!(
            s.close("t1", Some("yui")).err(),
            Some("error: not your terminal: t1".into())
        );
        assert_eq!(s.close("t2", Some("yui")).err(), None);
        assert_eq!(
            s.close("t2", Some("yui")).err(),
            Some("error: unknown terminal: t2".into())
        );
        assert_eq!(s.close("t1", None).err(), None);
    }
}
