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
