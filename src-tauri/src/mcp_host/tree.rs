//! One server's process tree: a process group on Unix, a job object on Windows.

use process_wrap::tokio::{ChildWrapper, CommandWrap};
use std::io;

#[cfg(windows)]
use std::sync::Arc;

/// A server's process tree. Cheap to clone; the Windows job closes with its last clone.
#[derive(Clone)]
pub struct Tree {
    /// The leader's pid, which is the process group id.
    #[cfg(unix)]
    pgid: Option<u32>,
    #[cfg(windows)]
    job: Arc<windows_job::Job>,
}

#[cfg(unix)]
impl Tree {
    /// Spawns `command` as the leader of a new process group.
    pub fn start(mut command: CommandWrap) -> io::Result<(Box<dyn ChildWrapper>, Tree)> {
        command.wrap(process_wrap::tokio::ProcessGroup::leader());
        let child = command.spawn()?;
        let tree = Tree { pgid: child.id() };
        Ok((child, tree))
    }

    /// The process group id; recorded so the next start can kill a group the app left behind.
    pub fn group_id(&self) -> Option<u32> {
        self.pgid
    }

    /// SIGKILL to the group.
    pub fn kill(&self) {
        use nix::sys::signal::{killpg, Signal};
        let Some(pgid) = self.pgid else {
            return;
        };
        match killpg(nix::unistd::Pid::from_raw(pgid as i32), Signal::SIGKILL) {
            Ok(()) | Err(nix::errno::Errno::ESRCH) => {}
            Err(e) => log::warn!("mcp_host_killpg_failed pgid={pgid} error={e}"),
        }
    }
}

#[cfg(windows)]
impl Tree {
    /// Spawns `command` suspended, puts it in a new job, then resumes it.
    pub fn start(mut command: CommandWrap) -> io::Result<(Box<dyn ChildWrapper>, Tree)> {
        let job = Arc::new(windows_job::Job::create()?);
        command
            .wrap(windows_job::Attach(job.clone()))
            .wrap(process_wrap::tokio::KillOnDrop);
        let child = command.spawn()?;
        Ok((child, Tree { job }))
    }

    /// A job object ends with the app, so there is no group to record.
    pub fn group_id(&self) -> Option<u32> {
        None
    }

    /// Ends every process in the job.
    pub fn kill(&self) {
        if let Err(e) = self.job.terminate() {
            log::warn!("mcp_host_job_kill_failed error={e}");
        }
    }
}

#[cfg(windows)]
mod windows_job {
    use process_wrap::tokio::CommandWrapper;
    use std::io;
    use std::sync::Arc;
    use tokio::process::{Child, Command};
    use windows::Win32::Foundation::{CloseHandle, ERROR_NO_MORE_FILES, HANDLE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{
        OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
    };

    /// A handle closed on drop.
    #[derive(Debug)]
    struct Owned(HANDLE);

    // A kernel handle is usable from any thread.
    unsafe impl Send for Owned {}
    unsafe impl Sync for Owned {}

    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) }.ok();
        }
    }

    /// A job object; its last handle closing kills what is left in it.
    #[derive(Debug)]
    pub struct Job(Owned);

    impl Job {
        pub fn create() -> io::Result<Self> {
            let job = Owned(unsafe { CreateJobObjectW(None, None) }?);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            // Not SILENT_BREAKAWAY_OK: a child stays in the job unless it asks to leave.
            info.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
            unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as _,
                    std::mem::size_of_val(&info) as u32,
                )
            }?;
            Ok(Self(job))
        }

        pub fn terminate(&self) -> io::Result<()> {
            Ok(unsafe { TerminateJobObject(self.0 .0, 1) }?)
        }
    }

    /// Starts the child suspended, puts it in the job before its first instruction, resumes it.
    #[derive(Debug)]
    pub struct Attach(pub Arc<Job>);

    impl CommandWrapper for Attach {
        fn pre_spawn(
            &mut self,
            command: &mut Command,
            _core: &process_wrap::tokio::CommandWrap,
        ) -> io::Result<()> {
            command.creation_flags((CREATE_SUSPENDED | CREATE_NO_WINDOW).0);
            Ok(())
        }

        fn post_spawn(
            &mut self,
            _command: &mut Command,
            child: &mut Child,
            _core: &process_wrap::tokio::CommandWrap,
        ) -> io::Result<()> {
            let attached = attach(&self.0, child);
            if attached.is_err() {
                let _ = child.start_kill();
            }
            attached
        }
    }

    fn attach(job: &Job, child: &Child) -> io::Result<()> {
        let process = child
            .raw_handle()
            .ok_or_else(|| io::Error::other("the child has no process handle"))?;
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("the child has no pid"))?;
        unsafe { AssignProcessToJobObject((job.0).0, HANDLE(process)) }?;
        resume(pid)
    }

    /// Resumes the threads of the suspended process `pid`; tokio's `Child` keeps no thread handle.
    fn resume(pid: u32) -> io::Result<()> {
        let snapshot = Owned(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }?);
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        unsafe { Thread32First(snapshot.0, &mut entry) }?;
        let mut resumed = false;
        loop {
            if entry.th32OwnerProcessID == pid {
                let thread =
                    Owned(unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID) }?);
                if unsafe { ResumeThread(thread.0) } == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                resumed = true;
            }
            match unsafe { Thread32Next(snapshot.0, &mut entry) } {
                Ok(()) => {}
                Err(e) if e.code() == ERROR_NO_MORE_FILES.to_hresult() => break,
                Err(e) => return Err(e.into()),
            }
        }
        if resumed {
            Ok(())
        } else {
            Err(io::Error::other("no thread of the child was found"))
        }
    }
}
