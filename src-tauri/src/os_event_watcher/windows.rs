//! Windows OS polling — active app (Win32 foreground window), idle
//! (GetLastInputInfo), window title + fullscreen (window/monitor rect
//! comparison), window enumeration (EnumWindows) for `list_windows`.
//!
//! Implements:
//!   - `start_polling`: starts the shared background polling loop.
//!   - left-button state reads for the shared drop-release probe.
//!   - `list_all_windows`: enumerates foreign on-screen top-level windows for
//!     the `list_windows` command.
//!
//! All functions must not panic; degrade gracefully.

use super::{polling_loop, sanitise_window_title, PollingWindowInfo, WindowAtPoint};
use std::{ffi::c_void, path::Path, thread};
use tauri::AppHandle;
use windows::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, RECT},
    Graphics::{
        Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        Gdi::{
            GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
    },
    System::{
        SystemInformation::GetTickCount,
        Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    },
    UI::{
        HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
        Input::KeyboardAndMouse::{GetAsyncKeyState, GetLastInputInfo, LASTINPUTINFO, VK_LBUTTON},
        WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow,
            GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
        },
    },
};

// Shell chrome class names excluded from `list_all_windows` (desktop + taskbars).
const SHELL_CLASS_BLOCKLIST: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
];

// ─── Drop-release probe ───────────────────────────────────────────────────────

/// Returns true when `GetAsyncKeyState(VK_LBUTTON)` reports the button as down
/// (high-order bit of the returned i16 is set).
///
/// Extracted as a pure-ish helper so the state-machine logic is testable without
/// calling the Win32 FFI in unit tests.
pub(super) fn platform_lbutton_is_down() -> bool {
    // SAFETY: GetAsyncKeyState is always safe to call; it does not mutate state.
    let state = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) };
    (state as u16 & 0x8000u16) != 0
}

// ─── Pure helpers for the real Win32 watcher (FFI-free, unit-tested) ────────
//
// These back the idle / active-app / fullscreen / list_windows implementation
// that wires them to Win32 FFI calls; kept FFI-free here so the arithmetic and
// filtering logic is directly unit-testable.

// Standard 96-DPI baseline used to derive the physical→logical scale factor.
const BASELINE_DPI: f64 = 96.0;

/// Idle milliseconds from a `GetTickCount()` reading and the last-input tick.
///
/// `dwTime` is not guaranteed to be <= the current tick (SendInput can supply
/// a future tick, or raw-input/desktop thread timing can gap); a wrapped
/// "huge" diff (> i32::MAX as u32) is treated as 0 rather than as ~49 days.
fn idle_ms_from_ticks(now_tick: u32, last_tick: u32) -> u64 {
    let diff = now_tick.wrapping_sub(last_tick);
    if diff > i32::MAX as u32 {
        0
    } else {
        diff as u64
    }
}

/// Extracts the executable file stem (no extension) from a full image path.
///
/// `C:\...\chrome.exe` → `Some("chrome")`. `None` for a path with no file
/// stem (e.g. an empty string).
fn app_name_from_exe_path(path: &str) -> Option<String> {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
}

/// True when `win` fully covers `mon` (physical pixels, both rects in the
/// same coordinate space — no DPI conversion needed for this comparison).
fn rect_covers_monitor(win: RECT, mon: RECT) -> bool {
    win.left <= mon.left && win.top <= mon.top && win.right >= mon.right && win.bottom >= mon.bottom
}

/// One enumerated top-level window in physical-pixel screen space.
/// `dpi` is the effective DPI of the window's monitor — not the window's own
/// DPI, which diverges for system-aware/unaware apps on mixed-DPI setups.
#[derive(Debug, Clone, PartialEq)]
struct PhysicalWindow {
    rect: RECT,
    pid: i32,
    name: Option<String>,
    window_number: u32,
    dpi: u32,
}

/// Converts a physical-pixel window rect into the logical-point
/// `WindowAtPoint` the frontend expects (matches `drag.rs` / Tauri logical =
/// physical / scale_factor, scale_factor = monitor effective dpi / 96).
fn physical_window_to_at_point(w: &PhysicalWindow) -> Option<WindowAtPoint> {
    if w.dpi == 0 {
        return None;
    }
    let scale = w.dpi as f64 / BASELINE_DPI;
    let x = w.rect.left as f64 / scale;
    let y = w.rect.top as f64 / scale;
    let width = (w.rect.right - w.rect.left) as f64 / scale;
    let height = (w.rect.bottom - w.rect.top) as f64 / scale;
    Some(WindowAtPoint {
        x,
        y,
        width,
        height,
        name: w.name.clone(),
        owner_name: None, // Enumerated Windows windows do not resolve app-owner names.
        pid: w.pid,
        window_number: w.window_number,
    })
}

/// Pure own-pid filter (no FFI), mirroring the macOS `filter_foreign` shape
/// so ordering/exclusion stays unit-testable.
fn filter_foreign(windows: Vec<PhysicalWindow>, own_pid: i32) -> Vec<PhysicalWindow> {
    windows.into_iter().filter(|w| w.pid != own_pid).collect()
}

// ─── idle time ────────────────────────────────────────────────────────────────

/// OS-wide idle milliseconds via `GetLastInputInfo` + `GetTickCount`.
fn os_idle_ms() -> Option<u64> {
    let mut lii = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let ok = unsafe { GetLastInputInfo(&mut lii) };
    if !ok.as_bool() {
        log::debug!("get_last_input_info_failed skipped=true");
        return None;
    }
    let now_tick = unsafe { GetTickCount() };
    Some(idle_ms_from_ticks(now_tick, lii.dwTime))
}

pub(super) fn platform_idle_ms() -> Option<u64> {
    os_idle_ms()
}

// ─── active app + window title ─────────────────────────────────────────────

/// Info gathered for the current foreground window.
struct WindowInfo {
    title: Option<String>,
    is_fullscreen: bool,
}

/// Returns (pid, app_name) for the foreground window, or `None` if there is
/// none (e.g. nothing focused) or the process image path can't be resolved.
fn frontmost_app() -> Option<(u32, String)> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        log::debug!("frontmost_app_none skipped=true");
        return None;
    }

    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        log::debug!("frontmost_app_pid_zero skipped=true");
        return None;
    }

    let exe_path = process_image_path(pid)?;
    let app_name = app_name_from_exe_path(&exe_path)?;
    Some((pid, app_name))
}

/// Resolves a process's full image path via `OpenProcess` +
/// `QueryFullProcessImageNameW`, closing the handle on every exit path.
fn process_image_path(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;

    let mut buf = [0u16; 1024];
    let mut size = buf.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
    };
    unsafe {
        let _ = CloseHandle(handle);
    }

    if result.is_err() {
        log::debug!("query_full_process_image_name_failed pid={pid}");
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..size as usize]))
}

/// Reads the window title of `hwnd` via `GetWindowTextW`.
fn window_title(hwnd: HWND) -> Option<String> {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len <= 0 {
        return None;
    }
    sanitise_window_title(&String::from_utf16_lossy(&buf[..len as usize]))
}

// ─── fullscreen heuristic ───────────────────────────────────────────────────

/// Foreground-window fullscreen heuristic: the window's rect covers its
/// monitor's rect. Desktop/shell windows are excluded (never "fullscreen").
fn is_fullscreen(hwnd: HWND) -> bool {
    let desktop = unsafe { GetDesktopWindow() };
    let shell = unsafe { GetShellWindow() };
    if hwnd == desktop || hwnd == shell {
        return false;
    }

    let mut win_rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut win_rect) }.is_err() {
        log::debug!("get_window_rect_failed skipped=true");
        return false;
    }

    let hmonitor: HMONITOR = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let mut mon_info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let ok = unsafe { GetMonitorInfoW(hmonitor, &mut mon_info) };
    if !ok.as_bool() {
        log::debug!("get_monitor_info_failed skipped=true");
        return false;
    }

    rect_covers_monitor(win_rect, mon_info.rcMonitor)
}

/// Gathers title + fullscreen state for the current foreground window.
fn frontmost_window_info(hwnd: HWND) -> WindowInfo {
    WindowInfo {
        title: window_title(hwnd),
        is_fullscreen: is_fullscreen(hwnd),
    }
}

pub(super) fn platform_frontmost() -> Option<(String, Option<PollingWindowInfo>)> {
    let (_pid, app_name) = frontmost_app()?;
    let hwnd = unsafe { GetForegroundWindow() };
    let info = frontmost_window_info(hwnd);
    Some((
        app_name,
        Some(PollingWindowInfo {
            title: info.title,
            is_fullscreen: info.is_fullscreen,
        }),
    ))
}

// ─── window enumeration (list_windows) ──────────────────────────────────────

/// Public window list for the `list_windows` command: every foreign on-screen
/// top-level window in front-to-back (topmost first) order.
pub fn list_all_windows() -> Vec<WindowAtPoint> {
    let own_pid = std::process::id() as i32;
    filter_foreign(enumerate_windows(), own_pid)
        .iter()
        .filter_map(physical_window_to_at_point)
        .collect()
}

/// True when `hwnd`'s window class matches the shell-chrome blocklist.
fn is_shell_chrome(hwnd: HWND) -> bool {
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return false;
    }
    let class_name = String::from_utf16_lossy(&buf[..len as usize]);
    SHELL_CLASS_BLOCKLIST.contains(&class_name.as_str())
}

/// True when DWM reports `hwnd` as cloaked (suspended UWP ghost window).
fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };
    result.is_ok() && cloaked != 0
}

/// Effective DPI of the monitor hosting `hwnd` (0 when unresolvable).
///
/// The MONITOR effective DPI — not `GetDpiForWindow` — is what maps the
/// physical screen-space rect into Tauri's logical frame: the webview compares
/// these rects against `outerPosition()/scaleFactor()`, and Tauri's scale
/// factor is the monitor's, regardless of the foreign window's own DPI
/// awareness (a system-aware app on a 100% monitor reports its internal 120
/// DPI, but its on-screen rect is still in that monitor's physical space).
fn window_monitor_dpi(hwnd: HWND) -> u32 {
    let hmonitor: HMONITOR = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let (mut dpi_x, mut dpi_y) = (0u32, 0u32);
    if unsafe { GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) }.is_err() {
        log::debug!("get_dpi_for_monitor_failed skipped=true");
        return 0;
    }
    dpi_x
}

/// Extended-frame-bounds rect (excludes Win10 invisible resize borders),
/// falling back to `GetWindowRect` when the DWM call fails.
fn extended_frame_bounds(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if result.is_ok() {
        return Some(rect);
    }
    let mut fallback = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut fallback) }.ok()?;
    Some(fallback)
}

/// `EnumWindows` callback: applies the visibility/style/cloak/chrome/rect
/// filters (cheapest first) and appends surviving windows to the out `Vec`.
unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let out = &mut *(lparam.0 as *mut Vec<PhysicalWindow>);

    if !IsWindowVisible(hwnd).as_bool() {
        return windows::core::BOOL(1);
    }
    if IsIconic(hwnd).as_bool() {
        return windows::core::BOOL(1);
    }

    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
        return windows::core::BOOL(1);
    }

    if is_cloaked(hwnd) {
        return windows::core::BOOL(1);
    }

    if is_shell_chrome(hwnd) {
        return windows::core::BOOL(1);
    }

    let Some(rect) = extended_frame_bounds(hwnd) else {
        return windows::core::BOOL(1);
    };
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return windows::core::BOOL(1);
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    let dpi = window_monitor_dpi(hwnd);
    let name = window_title(hwnd);

    out.push(PhysicalWindow {
        rect,
        pid: pid as i32,
        name,
        window_number: hwnd.0 as usize as u32,
        dpi,
    });

    windows::core::BOOL(1)
}

/// Enumerates top-level windows via `EnumWindows`, front-to-back (topmost
/// first, matching `EnumWindows` Z-order) into `PhysicalWindow`s.
fn enumerate_windows() -> Vec<PhysicalWindow> {
    let mut collected: Vec<PhysicalWindow> = Vec::new();
    let lparam = LPARAM(&mut collected as *mut Vec<PhysicalWindow> as isize);
    if unsafe { EnumWindows(Some(enum_windows_proc), lparam) }.is_err() {
        log::debug!("enum_windows_failed skipped=true");
    }
    collected
}

// ─── Background polling loop ──────────────────────────────────────────────────

pub fn start_polling(app: AppHandle) {
    thread::Builder::new()
        .name("os_event_watcher_win".into())
        .spawn(move || polling_loop(app))
        .expect("failed to spawn os_event_watcher_win thread");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── idle_ms_from_ticks ───────────────────────────────────────────────────

    #[test]
    fn idle_ms_from_ticks_normal_diff() {
        assert_eq!(idle_ms_from_ticks(10_000, 7_500), 2_500);
    }

    #[test]
    fn idle_ms_from_ticks_equal_ticks() {
        assert_eq!(idle_ms_from_ticks(5_000, 5_000), 0);
    }

    #[test]
    fn idle_ms_from_ticks_wrap_around_gives_small_diff() {
        // GetTickCount wraps every ~49.7 days (u32::MAX ms). now < last_tick
        // right after a wrap should still yield a small, correct diff via
        // wrapping_sub — not a huge underflowed number.
        let last_tick = u32::MAX - 100; // just before wrap
        let now_tick = 50u32; // just after wrap
        assert_eq!(idle_ms_from_ticks(now_tick, last_tick), 151);
    }

    #[test]
    fn idle_ms_from_ticks_future_tick_clamps_to_zero() {
        // dwTime ahead of "now" (SendInput/raw-input timing gap) is not a
        // real ~49-day idle — clamp to 0 instead of returning a huge value.
        assert_eq!(idle_ms_from_ticks(1_000, 5_000), 0);
    }

    // ── app_name_from_exe_path ───────────────────────────────────────────────

    #[test]
    fn app_name_from_exe_path_normal() {
        assert_eq!(
            app_name_from_exe_path(r"C:\Program Files\Google\Chrome\chrome.exe"),
            Some("chrome".into())
        );
    }

    #[test]
    fn app_name_from_exe_path_no_extension() {
        assert_eq!(
            app_name_from_exe_path(r"C:\tools\myapp"),
            Some("myapp".into())
        );
    }

    #[test]
    fn app_name_from_exe_path_trailing_backslash() {
        // Rust's `Path` treats a trailing separator as insignificant, so the
        // last named component is still the file stem.
        assert_eq!(
            app_name_from_exe_path(r"C:\Program Files\App\"),
            Some("App".into())
        );
    }

    #[test]
    fn app_name_from_exe_path_empty() {
        assert_eq!(app_name_from_exe_path(""), None);
    }

    // ── rect_covers_monitor ──────────────────────────────────────────────────

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn rect_covers_monitor_exact_cover() {
        let mon = rect(0, 0, 2560, 1440);
        let win = rect(0, 0, 2560, 1440);
        assert!(rect_covers_monitor(win, mon));
    }

    #[test]
    fn rect_covers_monitor_partial_does_not_cover() {
        let mon = rect(0, 0, 2560, 1440);
        let win = rect(0, 0, 1280, 1440);
        assert!(!rect_covers_monitor(win, mon));
    }

    #[test]
    fn rect_covers_monitor_smaller_does_not_cover() {
        let mon = rect(0, 0, 2560, 1440);
        let win = rect(100, 100, 800, 600);
        assert!(!rect_covers_monitor(win, mon));
    }

    #[test]
    fn rect_covers_monitor_larger_window_covers() {
        // Window rect extending beyond the monitor still "covers" it.
        let mon = rect(0, 0, 1920, 1080);
        let win = rect(-10, -10, 1930, 1090);
        assert!(rect_covers_monitor(win, mon));
    }

    // ── physical_window_to_at_point (physical → logical) ─────────────────────

    fn phys_window(left: i32, top: i32, right: i32, bottom: i32, dpi: u32) -> PhysicalWindow {
        PhysicalWindow {
            rect: rect(left, top, right, bottom),
            pid: 1234,
            name: Some("Notepad".into()),
            window_number: 42,
            dpi,
        }
    }

    #[test]
    fn physical_to_at_point_96_dpi_identity() {
        let w = phys_window(100, 200, 900, 800, 96);
        let p = physical_window_to_at_point(&w).unwrap();
        assert!((p.x - 100.0).abs() < 1e-9);
        assert!((p.y - 200.0).abs() < 1e-9);
        assert!((p.width - 800.0).abs() < 1e-9);
        assert!((p.height - 600.0).abs() < 1e-9);
    }

    #[test]
    fn physical_to_at_point_144_dpi_is_1_5x_scale() {
        let w = phys_window(0, 0, 1200, 900, 144);
        let p = physical_window_to_at_point(&w).unwrap();
        assert!((p.width - 800.0).abs() < 1e-9);
        assert!((p.height - 600.0).abs() < 1e-9);
    }

    #[test]
    fn physical_to_at_point_192_dpi_is_2x_scale() {
        let w = phys_window(0, 0, 1600, 1200, 192);
        let p = physical_window_to_at_point(&w).unwrap();
        assert!((p.width - 800.0).abs() < 1e-9);
        assert!((p.height - 600.0).abs() < 1e-9);
    }

    #[test]
    fn physical_to_at_point_zero_dpi_returns_none() {
        let w = phys_window(0, 0, 100, 100, 0);
        assert!(physical_window_to_at_point(&w).is_none());
    }

    #[test]
    fn physical_to_at_point_preserves_name_pid_window_number() {
        let w = phys_window(0, 0, 100, 100, 96);
        let p = physical_window_to_at_point(&w).unwrap();
        assert_eq!(p.name, Some("Notepad".into()));
        assert_eq!(p.pid, 1234);
        assert_eq!(p.window_number, 42);
    }

    // ── filter_foreign (pure own-pid filter, order-preserving) ──────────────

    fn win(pid: i32) -> PhysicalWindow {
        PhysicalWindow {
            rect: rect(0, 0, 100, 100),
            pid,
            name: None,
            window_number: 0,
            dpi: 96,
        }
    }

    #[test]
    fn filter_foreign_drops_own_and_preserves_order() {
        let own = 4242;
        let windows = vec![win(11), win(own), win(22)];
        let kept = filter_foreign(windows, own);
        let pids: Vec<i32> = kept.iter().map(|w| w.pid).collect();
        assert_eq!(pids, vec![11, 22]);
    }

    #[test]
    fn filter_foreign_empty_is_empty() {
        assert!(filter_foreign(Vec::new(), 999).is_empty());
    }
}
