use super::screen;
use super::store::{Terminal, TerminalOwner, TerminalStore};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{ErrorKind, Read, Write};
use std::num::NonZeroU16;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tauri::ipc::{Channel, InvokeResponseBody};

pub type Store = TerminalStore<Pty>;

const SCROLLBACK: usize = 2000;

struct Output {
    parser: vt100::Parser,
    channel: Option<Channel<InvokeResponseBody>>,
}

/// One terminal's process, its PTY, and the parsed screen its output draws.
pub struct Pty {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    output: Arc<Mutex<Output>>,
}

fn lock<T: ?Sized>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn nonzero(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap_or(NonZeroU16::MIN)
}

fn failed(error: impl std::fmt::Display) -> String {
    format!("error: {error}")
}

fn spawn(
    _: &Arc<Store>,
    _: TerminalOwner,
    _: String,
    _: CommandBuilder,
    _: u64,
) -> Result<Terminal, String> {
    Err("unimplemented".into())
}

impl Pty {
    pub fn read(&self, _: &Terminal, _: Option<u32>) -> String {
        String::new()
    }
    pub fn kill(&self) {}
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use nix::sys::signal::kill;
    use nix::unistd::Pid;
    use std::time::{Duration, Instant};

    fn store() -> Arc<Store> {
        Arc::new(TerminalStore::new(Duration::from_secs(60), |_| {}))
    }

    fn sh(script: &str) -> CommandBuilder {
        let mut command = CommandBuilder::new("sh");
        command.args(["-c", script]);
        command
    }

    fn until<T>(mut check: impl FnMut() -> Option<T>) -> T {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(value) = check() {
                return value;
            }
            assert!(Instant::now() < deadline, "timed out");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn output_reads_back_and_the_exit_code_is_recorded() {
        let s = store();
        spawn(
            &s,
            TerminalOwner::User,
            "~".into(),
            sh("echo hi; exit 3"),
            1,
        )
        .unwrap();
        let terminal = until(|| {
            s.snapshot()
                .terminals
                .pop()
                .filter(|t| t.exit_code.is_some())
        });
        assert_eq!(terminal.exit_code, Some(3));
        assert!(
            s.get("t1")
                .unwrap()
                .read(&terminal, None)
                .ends_with("t1 (~), exited 3\nhi"),
            "{}",
            s.get("t1").unwrap().read(&terminal, None)
        );
    }

    #[test]
    fn killing_a_terminal_ends_its_shell_and_the_shell_children() {
        let s = store();
        let terminal = spawn(
            &s,
            TerminalOwner::User,
            "~".into(),
            sh("sleep 60 & echo pids $$ $!; wait"),
            1,
        )
        .unwrap();
        let pty = s.get("t1").unwrap();
        let pids: Vec<Pid> = until(|| {
            let text = pty.read(&terminal, None);
            let line = text.lines().find_map(|l| l.strip_prefix("pids "))?;
            Some(
                line.split(' ')
                    .map(|p| Pid::from_raw(p.parse().unwrap()))
                    .collect(),
            )
        });
        assert!(pids.iter().all(|&pid| kill(pid, None).is_ok()));
        s.close("t1", None).unwrap().kill();
        until(|| {
            pids.iter()
                .all(|&pid| kill(pid, None).is_err())
                .then_some(())
        });
    }
}
