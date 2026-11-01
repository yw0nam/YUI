use serde::Serialize;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

pub const TURN_STOPPED: &str = "error: turn stopped";
const NO_ANSWER: &str = "denied: no answer in 60 s";
const REFUSED_CAP: usize = 64;

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

struct Pending {
    call_id: String,
    request: AccessRequest,
    until: Instant,
}

struct State<P> {
    terminals: Vec<(Terminal, Arc<P>)>,
    pending: Vec<Pending>,
    // Refusals not yet taken by their call; capped, as a cancel can outlive its call.
    refused: Vec<(String, String)>,
    revision: u64,
    opened: u64,
    asked: u64,
    size: (u16, u16),
}

impl<P> State<P> {
    fn find(&self, id: &str) -> Result<usize, String> {
        self.terminals
            .iter()
            .position(|(t, _)| t.id == id)
            .ok_or_else(|| format!("error: unknown terminal: {id}"))
    }

    fn snapshot(&self) -> TerminalSnapshot {
        TerminalSnapshot {
            revision: self.revision,
            terminals: self.terminals.iter().map(|(t, _)| t.clone()).collect(),
            requests: self.pending.iter().map(|p| p.request.clone()).collect(),
        }
    }
}

/// Terminals, their owner and access, and the access requests their tool calls wait on.
pub struct TerminalStore<P> {
    state: Mutex<State<P>>,
    changed: Condvar,
    emit: Box<dyn Fn(&TerminalSnapshot) + Send + Sync>,
    limit: Duration,
}

impl<P> TerminalStore<P> {
    pub fn new(limit: Duration, emit: impl Fn(&TerminalSnapshot) + Send + Sync + 'static) -> Self {
        Self {
            state: Mutex::new(State {
                terminals: vec![],
                pending: vec![],
                refused: vec![],
                revision: 0,
                opened: 0,
                asked: 0,
                size: (120, 32),
            }),
            changed: Condvar::new(),
            emit: Box::new(emit),
            limit,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State<P>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Bumps the revision, wakes waiting calls, and emits the snapshot after the lock is released.
    fn publish(&self, mut state: MutexGuard<'_, State<P>>) {
        state.revision += 1;
        let snapshot = state.snapshot();
        drop(state);
        self.changed.notify_all();
        (self.emit)(&snapshot);
    }

    fn update<R>(&self, f: impl FnOnce(&mut State<P>) -> Result<R, String>) -> Result<R, String> {
        let mut state = self.lock();
        let result = f(&mut state)?;
        self.publish(state);
        Ok(result)
    }

    pub fn snapshot(&self) -> TerminalSnapshot {
        self.lock().snapshot()
    }

    /// The size every terminal shares, as (cols, rows).
    pub fn size(&self) -> (u16, u16) {
        self.lock().size
    }

    pub fn set_size(&self, cols: u16, rows: u16) {
        self.lock().size = (cols, rows);
    }

    pub fn all(&self) -> Vec<Arc<P>> {
        self.lock()
            .terminals
            .iter()
            .map(|(_, p)| p.clone())
            .collect()
    }

    pub fn add(&self, owner: TerminalOwner, title: String, pty: Arc<P>, now: u64) -> Terminal {
        self.update(|state| {
            state.opened += 1;
            let terminal = Terminal {
                id: format!("t{}", state.opened),
                owner,
                title,
                opened_at: now,
                exit_code: None,
                access: None,
                last_command: None,
            };
            state.terminals.push((terminal.clone(), pty));
            Ok(terminal)
        })
        .expect("adding a terminal cannot fail")
    }

    /// The terminal's process, for the user's input and output, which need no access.
    pub fn get(&self, id: &str) -> Result<Arc<P>, String> {
        let state = self.lock();
        Ok(state.terminals[state.find(id)?].1.clone())
    }

    /// Removes a terminal; a preset closes only its own. Its waiting calls end as unknown.
    pub fn close(&self, id: &str, preset_id: Option<&str>) -> Result<Arc<P>, String> {
        self.update(|state| {
            let index = state.find(id)?;
            if let Some(preset_id) = preset_id {
                let own = TerminalOwner::Preset {
                    preset_id: preset_id.into(),
                };
                if state.terminals[index].0.owner != own {
                    return Err(format!("error: not your terminal: {id}"));
                }
            }
            state.pending.retain(|p| p.request.terminal_id != id);
            Ok(state.terminals.remove(index).1)
        })
    }

    pub fn exited(&self, id: &str, code: u32) {
        let _ = self.update(|state| {
            let index = state.find(id)?;
            state.terminals[index].0.exit_code = Some(code);
            Ok(())
        });
    }

    pub fn take_back(&self, id: &str) -> Result<(), String> {
        self.update(|state| {
            let index = state.find(id)?;
            state.terminals[index].0.access = None;
            Ok(())
        })
    }

    /// Allow moves access to the request's preset and frees its calls; Deny refuses one call.
    pub fn answer(&self, request_id: &str, allow: bool) -> Result<(), String> {
        self.update(|state| {
            let index = state
                .pending
                .iter()
                .position(|p| p.request.id == request_id)
                .ok_or_else(|| format!("error: unknown request: {request_id}"))?;
            let pending = state.pending.remove(index);
            if !allow {
                state.refused.push((pending.call_id, "denied".into()));
                return Ok(());
            }
            let AccessRequest {
                terminal_id,
                preset_id,
                ..
            } = pending.request;
            state.pending.retain(|p| {
                p.request.terminal_id != terminal_id || p.request.preset_id != preset_id
            });
            let index = state.find(&terminal_id)?;
            state.terminals[index].0.access = Some(preset_id);
            Ok(())
        })
    }

    /// Stops the call now, or when it registers if the cancel arrives first.
    pub fn cancel(&self, call_id: &str) {
        let mut state = self.lock();
        if state.refused.len() == REFUSED_CAP {
            state.refused.remove(0);
        }
        state.refused.push((call_id.into(), TURN_STOPPED.into()));
        if let Some(index) = state.pending.iter().position(|p| p.call_id == call_id) {
            state.pending.remove(index);
            self.publish(state);
        }
    }

    /// Waits for the preset's access, asking once; a write records its first line as last command.
    pub fn gate(
        &self,
        call_id: &str,
        preset_id: &str,
        id: &str,
        kind: AccessKind,
        text: Option<&str>,
        now: u64,
    ) -> Result<(Arc<P>, Terminal), String> {
        let mut state = self.lock();
        loop {
            if let Some(index) = state.refused.iter().position(|(c, _)| c == call_id) {
                return Err(state.refused.remove(index).1);
            }
            let index = state.find(id)?;
            let (terminal, pty) = &state.terminals[index];
            if kind == AccessKind::Write && terminal.exit_code.is_some() {
                return Err(format!("error: terminal exited: {id}"));
            }
            let pending = state.pending.iter().position(|p| p.call_id == call_id);
            match pending {
                None if terminal.access.as_deref() == Some(preset_id) => {
                    let pty = pty.clone();
                    let command = text.and_then(|t| t.lines().next()).map(str::trim);
                    let Some(command) = command.filter(|c| !c.is_empty()) else {
                        return Ok((pty, terminal.clone()));
                    };
                    let terminal = &mut state.terminals[index].0;
                    terminal.last_command = Some(command.into());
                    let terminal = terminal.clone();
                    self.publish(state);
                    return Ok((pty, terminal));
                }
                None => {
                    state.asked += 1;
                    let request = AccessRequest {
                        id: format!("r{}", state.asked),
                        terminal_id: id.into(),
                        preset_id: preset_id.into(),
                        kind,
                        text: text.map(str::to_owned),
                        deadline: now + self.limit.as_millis() as u64,
                    };
                    state.pending.push(Pending {
                        call_id: call_id.into(),
                        request,
                        until: Instant::now() + self.limit,
                    });
                    self.publish(state);
                    state = self.lock();
                }
                Some(index) => {
                    let remaining = state.pending[index]
                        .until
                        .saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        state.pending.remove(index);
                        self.publish(state);
                        return Err(NO_ANSWER.into());
                    }
                    state = self
                        .changed
                        .wait_timeout(state, remaining)
                        .unwrap_or_else(PoisonError::into_inner)
                        .0;
                }
            }
        }
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
    fn a_cancel_before_the_call_registers_stops_it_at_once() {
        let (s, _rx) = store(Duration::from_millis(200));
        s.add(TerminalOwner::User, "~".into(), Arc::new(()), 1);
        s.cancel("c1");
        let read = call(&s, "c1", "yui", AccessKind::Read, None);
        assert_eq!(read.join().unwrap(), Err(TURN_STOPPED.into()));
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
