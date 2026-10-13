//! Ownership of the dedicated Chrome: the profile lock, Chrome's singleton records, and the owned process.

use super::gate::Op;
use super::outcome::{setup_failed, PROFILE_IN_USE};
use std::fs::{File, TryLockError};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const PROFILE_DIR: &str = "browser-profile";
const LOCK_FILE: &str = "browser-profile.lock";
const SINGLETON_LOCK: &str = "SingletonLock";
const SINGLETON_RECORDS: [&str; 4] = [
    SINGLETON_LOCK,
    "SingletonSocket",
    "SingletonCookie",
    DEVTOOLS_PORT_FILE,
];
const DEVTOOLS_PORT_FILE: &str = "DevToolsActivePort";
const PORT_POLL: Duration = Duration::from_millis(100);

/// The exclusive lock on `<app data dir>/browser-profile.lock`, held while the app owns the browser.
pub struct ProfileLock {
    _file: File,
}

impl ProfileLock {
    pub fn acquire(path: &Path) -> Result<Self, String> {
        let file = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(path)
            .map_err(|_| setup_failed("lock_file"))?;
        match file.try_lock() {
            Ok(()) => Ok(Self { _file: file }),
            Err(TryLockError::WouldBlock) => Err(PROFILE_IN_USE.to_string()),
            Err(TryLockError::Error(_)) => Err(setup_failed("lock")),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Left by a dead process on this host; the records may be removed.
    Stale,
    Owned,
    InUse,
}

/// Judges a SingletonLock target, `<hostname>-<pid>`.
pub fn singleton_verdict(
    target: &str,
    this_host: &str,
    owned: Option<u32>,
    alive: impl Fn(u32) -> bool,
) -> Verdict {
    let Some((host, pid)) = target.rsplit_once('-') else {
        return Verdict::InUse;
    };
    let Ok(pid) = pid.parse::<u32>() else {
        return Verdict::InUse;
    };
    if host != this_host || pid == 0 {
        Verdict::InUse
    } else if !alive(pid) {
        Verdict::Stale
    } else if owned == Some(pid) {
        Verdict::Owned
    } else {
        Verdict::InUse
    }
}

#[cfg(unix)]
fn this_host() -> Option<String> {
    let mut buf = [0u8; 256];
    // SAFETY: the buffer outlives the call and its length is passed with it.
    if unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) } != 0 {
        return None;
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8(buf[..end].to_vec()).ok()
}

#[cfg(not(unix))]
fn this_host() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return true;
    };
    // SAFETY: signal 0 only checks that the process exists.
    let signalled = unsafe { libc::kill(pid, 0) } == 0;
    signalled || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(not(unix))]
pub fn pid_alive(_pid: u32) -> bool {
    true
}

/// Removes the singleton records of a dead Chrome on this host; any other holder answers profile in use.
fn clear_singleton(profile: &Path) -> Result<(), String> {
    let lock = profile.join(SINGLETON_LOCK);
    match std::fs::symlink_metadata(&lock) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(setup_failed("singleton")),
        Ok(_) => {}
    }
    let target = std::fs::read_link(&lock)
        .ok()
        .and_then(|t| t.to_str().map(str::to_string));
    let verdict = match (target, this_host()) {
        (Some(target), Some(host)) => singleton_verdict(&target, &host, None, pid_alive),
        _ => Verdict::InUse,
    };
    if verdict != Verdict::Stale {
        return Err(PROFILE_IN_USE.to_string());
    }
    for name in SINGLETON_RECORDS {
        let _ = std::fs::remove_file(profile.join(name));
    }
    Ok(())
}

fn prepare_profile(root: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root).map_err(|_| setup_failed("app_data_dir"))?;
    let profile = root.join(PROFILE_DIR);
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    match builder.create(&profile) {
        Err(e) if e.kind() != ErrorKind::AlreadyExists => Err(setup_failed("profile_dir")),
        _ => Ok(profile),
    }
}

#[cfg(target_os = "macos")]
fn chrome_path() -> Option<PathBuf> {
    let path = PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    path.exists().then_some(path)
}

#[cfg(not(target_os = "macos"))]
fn chrome_path() -> Option<PathBuf> {
    use chromiumoxide::detection::{default_executable, DetectionOptions};
    default_executable(DetectionOptions {
        msedge: false,
        unstable: false,
    })
    .ok()
}

/// A child process the app spawned; a reaper task owns it and fires `exited` once it is reaped.
pub struct OwnedChild {
    pid: u32,
    exited: CancellationToken,
    kill: oneshot::Sender<()>,
    reaper: JoinHandle<()>,
}

impl OwnedChild {
    pub fn spawn(mut command: tokio::process::Command) -> std::io::Result<Self> {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn()?;
        let pid = child.id().unwrap_or_default();
        let exited = CancellationToken::new();
        let (kill, killed) = oneshot::channel();
        let done = exited.clone();
        let reaper = tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {}
                _ = killed => {
                    let _ = child.kill().await;
                }
            }
            done.cancel();
        });
        Ok(Self {
            pid,
            exited,
            kill,
            reaper,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn exited(&self) -> &CancellationToken {
        &self.exited
    }

    /// Waits up to `grace` for the process to exit, then kills it and waits until it is reaped.
    pub async fn stop(self, grace: Duration) {
        let _ = tokio::time::timeout(grace, self.exited.cancelled()).await;
        let _ = self.kill.send(());
        let _ = self.reaper.await;
    }
}

/// A launched Chrome on the dedicated profile, before the CDP connection.
pub struct Launched {
    pub child: OwnedChild,
    pub lock: ProfileLock,
    pub ws_url: String,
}

fn read_port_file(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut lines = text.lines();
    let port: u16 = lines.next()?.trim().parse().ok()?;
    let ws_path = lines.next()?.trim();
    ws_path
        .starts_with('/')
        .then(|| format!("ws://127.0.0.1:{port}{ws_path}"))
}

/// Takes the profile lock, clears stale singleton records and spawns Chrome on the dedicated profile.
pub async fn launch(op: &Op, root: &Path) -> Result<Launched, String> {
    let profile = prepare_profile(root)?;
    let lock = ProfileLock::acquire(&root.join(LOCK_FILE))?;
    clear_singleton(&profile)?;
    let port_file = profile.join(DEVTOOLS_PORT_FILE);
    match std::fs::remove_file(&port_file) {
        Err(e) if e.kind() != ErrorKind::NotFound => {
            return Err(setup_failed("devtools_port_file"))
        }
        _ => {}
    }
    let chrome = chrome_path().ok_or_else(|| setup_failed("chrome_not_found"))?;
    let mut command = tokio::process::Command::new(chrome);
    command
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--remote-debugging-port=0")
        .arg("--no-first-run")
        .arg("--no-default-browser-check");
    let child = OwnedChild::spawn(command).map_err(|_| setup_failed("spawn"))?;
    let ws_url = op
        .guard(async {
            while !child.exited().is_cancelled() {
                if let Some(ws_url) = read_port_file(&port_file) {
                    return Some(ws_url);
                }
                tokio::time::sleep(PORT_POLL).await;
            }
            None
        })
        .await;
    match ws_url {
        Ok(Some(ws_url)) => Ok(Launched {
            child,
            lock,
            ws_url,
        }),
        Ok(None) => {
            child.stop(Duration::ZERO).await;
            Err(setup_failed("devtools_port"))
        }
        Err(halt) => {
            child.stop(Duration::ZERO).await;
            Err(op.halted(halt))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn singleton_lock_of_a_dead_process_on_this_host_is_stale() {
        let dead = |_| false;
        let alive = |_| true;
        assert_eq!(
            singleton_verdict("my-host-4242", "my-host", None, dead),
            Verdict::Stale
        );
        assert_eq!(
            singleton_verdict("my-host-4242", "my-host", None, alive),
            Verdict::InUse
        );
        assert_eq!(
            singleton_verdict("my-host-4242", "my-host", Some(4242), alive),
            Verdict::Owned
        );
        assert_eq!(
            singleton_verdict("other-4242", "my-host", None, dead),
            Verdict::InUse
        );
        assert_eq!(
            singleton_verdict("garbage", "my-host", None, dead),
            Verdict::InUse
        );
        assert_eq!(
            singleton_verdict("my-host-x1", "my-host", None, dead),
            Verdict::InUse
        );
    }

    #[test]
    fn a_second_profile_lock_is_refused() {
        let dir = std::env::temp_dir().join(format!("yui-browser-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("browser-profile.lock");
        let _first = ProfileLock::acquire(&path).unwrap();
        assert_eq!(
            ProfileLock::acquire(&path).err().unwrap(),
            "error: browser profile in use"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stop_reaps_the_owned_process_and_leaves_others_running() {
        let mut stand_in = tokio::process::Command::new("sleep");
        stand_in.arg("60");
        let owned = OwnedChild::spawn(stand_in).unwrap();
        let pid = owned.pid();
        let mut unrelated = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();

        owned.stop(std::time::Duration::ZERO).await;

        assert!(!pid_alive(pid));
        assert!(unrelated.try_wait().unwrap().is_none());
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
    }
}
