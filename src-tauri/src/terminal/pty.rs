use super::input::Input;
use super::screen;
use super::store::{lock, Terminal, TerminalOwner, TerminalStore};
#[cfg(not(unix))]
use portable_pty::ChildKiller;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{ErrorKind, Read};
use std::num::NonZeroU16;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

pub type Store = TerminalStore<Pty>;

const SCROLLBACK: usize = 2000;
#[cfg(unix)]
const KILL_GRACE: std::time::Duration = std::time::Duration::from_millis(500);

struct Output {
    parser: vt100::Parser,
    channel: Option<Channel<InvokeResponseBody>>,
}

/// One terminal's process, its PTY, and the parsed screen its output draws.
pub struct Pty {
    master: Mutex<Box<dyn MasterPty + Send>>,
    input: Input,
    #[cfg(unix)]
    group: Option<u32>,
    #[cfg(not(unix))]
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    output: Arc<Mutex<Output>>,
}

fn nonzero(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap_or(NonZeroU16::MIN)
}

fn failed(error: impl std::fmt::Display) -> String {
    format!("error: {error}")
}

/// Starts the user's login shell in `cwd`, or in the home folder when `cwd` is absent or no folder.
pub fn open(
    store: &Arc<Store>,
    owner: TerminalOwner,
    cwd: Option<&str>,
    now: u64,
) -> Result<Terminal, String> {
    let home = std::env::home_dir().unwrap_or_default();
    let dir = cwd
        .map(PathBuf::from)
        .filter(|dir| dir.is_dir())
        .unwrap_or_else(|| home.clone());
    let title = match dir.strip_prefix(&home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_owned(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => dir.display().to_string(),
    };
    // portable-pty runs $SHELL as a login shell for the default program.
    let mut command = CommandBuilder::new_default_prog();
    command.cwd(&dir);
    command.env("TERM", "xterm-256color");
    spawn(store, owner, title, command, now)
}

fn spawn(
    store: &Arc<Store>,
    owner: TerminalOwner,
    title: String,
    command: CommandBuilder,
    now: u64,
) -> Result<Terminal, String> {
    let (cols, rows) = store.size();
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(failed)?;
    let mut reader = pair.master.try_clone_reader().map_err(failed)?;
    let writer = pair.master.take_writer().map_err(failed)?;
    let mut child = pair.slave.spawn_command(command).map_err(failed)?;
    drop(pair.slave);
    let output = Arc::new(Mutex::new(Output {
        parser: vt100::Parser::new(nonzero(rows), nonzero(cols), SCROLLBACK),
        channel: None,
    }));
    let pty = Arc::new(Pty {
        master: Mutex::new(pair.master),
        input: Input::new(writer),
        // The shell leads its own session, so its process group id is its pid.
        #[cfg(unix)]
        group: child.process_id(),
        #[cfg(not(unix))]
        killer: Mutex::new(child.clone_killer()),
        output: output.clone(),
    });
    let terminal = store.add(owner, title, pty.clone(), now);
    let size = store.size();
    if size != (cols, rows) {
        pty.resize(size.0, size.1);
    }
    log::info!(
        "terminal_opened id={} title={:?}",
        terminal.id,
        terminal.title
    );
    let (store, id) = (store.clone(), terminal.id.clone());
    std::thread::spawn(move || {
        let mut buf = [0; 8192];
        // Drains until the PTY closes; on Windows ClosePseudoConsole waits for this drain.
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => lock(&output).feed(&buf[..n]),
                Err(error) if error.kind() == ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
    });
    // Waits on the shell, not the output: a child or the Windows console can keep the PTY open.
    std::thread::spawn(move || {
        let code = child.wait().map_or(1, |status| status.exit_code());
        log::info!("terminal_exited id={id} code={code}");
        store.exited(&id, code);
    });
    Ok(terminal)
}

impl Output {
    /// Parses the bytes and sends them to the attached view, under the one lock attach also takes.
    fn feed(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
        let sent = self
            .channel
            .as_ref()
            .map(|channel| channel.send(InvokeResponseBody::Raw(bytes.to_vec())));
        if let Some(Err(error)) = sent {
            log::warn!("terminal_output_send_failed error={error}");
            self.channel = None;
        }
    }
}

impl Pty {
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        self.input.send(data.to_vec())
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        if let Err(error) = lock(&self.master).resize(size) {
            log::warn!("terminal_resize_failed error={error}");
        }
        lock(&self.output)
            .parser
            .screen_mut()
            .set_size(nonzero(rows), nonzero(cols));
    }

    /// Sends the redrawn screen, then every later byte, to the channel in place of the old one.
    pub fn attach(&self, channel: Channel<InvokeResponseBody>) {
        let mut output = lock(&self.output);
        let redraw = screen::redraw(output.parser.screen());
        if let Err(error) = channel.send(InvokeResponseBody::Raw(redraw)) {
            log::warn!("terminal_output_send_failed error={error}");
        }
        output.channel = Some(channel);
    }

    pub fn read(&self, terminal: &Terminal, lines: Option<u32>) -> String {
        screen::read_text(terminal, lock(&self.output).parser.screen_mut(), lines)
    }

    pub fn kill(&self) {
        kill_all(&[self]);
    }

    /// Sends the signal to the shell's process group; false once the group is gone.
    #[cfg(unix)]
    fn signal(&self, signal: Option<nix::sys::signal::Signal>) -> bool {
        let Some(group) = self.group else {
            return false;
        };
        match nix::sys::signal::killpg(nix::unistd::Pid::from_raw(group as i32), signal) {
            Ok(()) => true,
            Err(nix::errno::Errno::ESRCH) => false,
            Err(error) => {
                log::warn!("terminal_kill_failed error={error}");
                false
            }
        }
    }
}

/// Hangs up every shell's process group, then kills what is left after one shared grace.
#[cfg(unix)]
pub fn kill_all(ptys: &[&Pty]) {
    use nix::sys::signal::Signal;
    let deadline = std::time::Instant::now() + KILL_GRACE;
    let mut alive: Vec<_> = ptys
        .iter()
        .filter(|p| p.signal(Some(Signal::SIGHUP)))
        .collect();
    while !alive.is_empty() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
        alive.retain(|p| p.signal(None));
    }
    for pty in alive {
        pty.signal(Some(Signal::SIGKILL));
    }
}

#[cfg(not(unix))]
pub fn kill_all(ptys: &[&Pty]) {
    for pty in ptys {
        if let Err(error) = lock(&pty.killer).kill() {
            log::warn!("terminal_kill_failed error={error}");
        }
    }
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
        let pty = s.get("t1").unwrap();
        // The exit can be recorded before the reader parses the last output.
        until(|| {
            let text = pty.read(&terminal, None);
            text.ends_with("t1 (~), exited 3\nhi").then_some(())
        });
    }

    #[test]
    fn the_shell_exit_is_recorded_while_a_child_still_holds_the_terminal() {
        let s = store();
        let script = "trap '' HUP; sleep 60 & echo pid $!; exit 3";
        let terminal = spawn(&s, TerminalOwner::User, "~".into(), sh(script), 1).unwrap();
        let pty = s.get("t1").unwrap();
        let child = until(|| {
            let text = pty.read(&terminal, None);
            let pid = text.lines().find_map(|l| l.strip_prefix("pid "))?;
            Some(Pid::from_raw(pid.parse().unwrap()))
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut exit_code = None;
        while exit_code.is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
            exit_code = s.snapshot().terminals[0].exit_code;
        }
        kill(child, nix::sys::signal::Signal::SIGKILL).unwrap();
        assert_eq!(exit_code, Some(3));
    }

    #[test]
    fn killing_a_terminal_ends_its_shell_and_the_shell_children() {
        // The second shell and its child ignore SIGHUP.
        for script in [
            "sleep 60 & echo pids $$ $!; wait",
            "trap '' HUP; sleep 60 & echo pids $$ $!; wait",
        ] {
            let s = store();
            let terminal = spawn(&s, TerminalOwner::User, "~".into(), sh(script), 1).unwrap();
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
}
