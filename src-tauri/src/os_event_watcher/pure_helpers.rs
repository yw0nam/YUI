use super::WindowAtPoint;

/// Converts idle seconds (f64) to milliseconds (u64), clamping negative to 0.
#[allow(dead_code)] // used by the macOS watcher; dead on other targets
pub fn idle_ms_from_secs(secs: f64) -> u64 {
    if secs < 0.0 {
        0
    } else {
        (secs * 1000.0) as u64
    }
}

/// Executable base names of macOS system helpers that own on-screen layer-0
/// windows while never being the app the user is looking at. Binary names, not
/// `kCGWindowOwnerName` — that one is localized and would miss on non-English
/// systems.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SYSTEM_HELPER_EXECUTABLES: &[&str] = &[
    "WindowManager",
    "Dock",
    "ControlCenter",
    "NotificationCenter",
    "Spotlight",
    "Screenshot",
    "screencaptureui",
];

/// The frontmost window a user can be looking at: the topmost window whose
/// owner executable is not a system helper. `executable` resolves an owner pid
/// to its binary base name; the pick itself is pure, so it is unit-testable.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn first_user_window(
    windows: Vec<WindowAtPoint>,
    executable: impl Fn(i32) -> Option<String>,
) -> Option<WindowAtPoint> {
    windows.into_iter().find(|w| {
        !executable(w.pid)
            .as_deref()
            .is_some_and(|exe| SYSTEM_HELPER_EXECUTABLES.contains(&exe))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── idle_ms_from_secs ────────────────────────────────────────────────────

    #[test]
    fn idle_ms_rounds_fractional_seconds() {
        // 1.5s → 1500ms
        assert_eq!(idle_ms_from_secs(1.5), 1500);
    }

    #[test]
    fn idle_ms_clamps_negative_to_zero() {
        // negative idle is nonsensical — clamp to 0
        assert_eq!(idle_ms_from_secs(-1.0), 0);
    }

    #[test]
    fn idle_ms_zero() {
        assert_eq!(idle_ms_from_secs(0.0), 0);
    }

    #[test]
    fn idle_ms_large_value() {
        // 3600s = 1h → 3_600_000ms
        assert_eq!(idle_ms_from_secs(3600.0), 3_600_000);
    }

    // ── frontmost user window ────────────────────────────────────────────────

    fn window(pid: i32, owner: Option<&str>, name: Option<&str>) -> WindowAtPoint {
        WindowAtPoint {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            name: name.map(str::to_string),
            owner_name: owner.map(str::to_string),
            pid,
            window_number: 1,
        }
    }

    /// Stand-in for `proc_pidpath`: pid → executable base name.
    fn executables<'a>(table: &'a [(i32, &'static str)]) -> impl Fn(i32) -> Option<String> + 'a {
        move |pid| {
            table
                .iter()
                .find(|(p, _)| *p == pid)
                .map(|(_, exe)| (*exe).to_string())
        }
    }

    #[test]
    fn frontmost_takes_the_topmost_window() {
        let picked = first_user_window(
            vec![
                window(10, Some("Safari"), Some("Start Page")),
                window(20, Some("Xcode"), Some("main.rs")),
            ],
            executables(&[(10, "Safari"), (20, "Xcode")]),
        );
        assert_eq!(picked.unwrap().owner_name.as_deref(), Some("Safari"));
    }

    #[test]
    fn frontmost_skips_a_system_helper_window() {
        // Stage Manager's helper floats above the real frontmost app.
        let picked = first_user_window(
            vec![
                window(10, Some("WindowManager"), Some("App Icon Window")),
                window(20, Some("Safari"), Some("Start Page")),
            ],
            executables(&[(10, "WindowManager"), (20, "Safari")]),
        );
        assert_eq!(picked.unwrap().owner_name.as_deref(), Some("Safari"));
    }

    #[test]
    fn frontmost_skips_a_helper_whose_display_name_is_localised() {
        // Korean macOS reports Control Center as "제어 센터"; the binary name
        // behind the pid stays "ControlCenter".
        let picked = first_user_window(
            vec![
                window(10, Some("제어 센터"), None),
                window(20, Some("사파리"), Some("시작 페이지")),
            ],
            executables(&[(10, "ControlCenter"), (20, "Safari")]),
        );
        assert_eq!(picked.unwrap().owner_name.as_deref(), Some("사파리"));
    }

    #[test]
    fn frontmost_skips_the_screenshot_overlay_process() {
        // The capture toolbar and selection overlay are drawn by
        // screencaptureui, not by the Screenshot.app launcher.
        let picked = first_user_window(
            vec![
                window(10, Some("screencaptureui"), None),
                window(20, Some("메모"), Some("장보기")),
            ],
            executables(&[(10, "screencaptureui"), (20, "Notes")]),
        );
        assert_eq!(picked.unwrap().name.as_deref(), Some("장보기"));
    }

    #[test]
    fn frontmost_keeps_an_app_whose_display_name_looks_like_a_helper() {
        // Matching is on the binary name, so a third-party app free to call
        // itself "Dock" is still a user window.
        let picked = first_user_window(
            vec![window(10, Some("Dock"), Some("Berth 4"))],
            executables(&[(10, "Dockyard")]),
        );
        assert_eq!(picked.unwrap().name.as_deref(), Some("Berth 4"));
    }

    #[test]
    fn frontmost_is_none_when_only_helpers_are_on_screen() {
        let picked = first_user_window(
            vec![
                window(10, Some("WindowManager"), Some("App Icon Window")),
                window(20, Some("제어 센터"), None),
                window(30, Some("스크린샷"), None),
                window(40, Some("screencaptureui"), None),
            ],
            executables(&[
                (10, "WindowManager"),
                (20, "ControlCenter"),
                (30, "Screenshot"),
                (40, "screencaptureui"),
            ]),
        );
        assert!(picked.is_none());
    }

    #[test]
    fn frontmost_keeps_a_window_whose_pid_does_not_resolve() {
        // A dead or unreadable pid must not silently drop the window.
        let picked = first_user_window(vec![window(10, None, Some("Untitled"))], |_| None);
        assert_eq!(picked.unwrap().name.as_deref(), Some("Untitled"));
    }
}
