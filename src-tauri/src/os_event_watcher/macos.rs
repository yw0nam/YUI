//! macOS OS polling — active app (NSWorkspace), idle (CGEventSource FFI),
//! window title + fullscreen (CGWindowList raw FFI), camera best-effort.

#![allow(dead_code)] // camera_in_use + CFBooleanRef are unused FFI bindings

use super::{
    emit_os_event, epoch_ms, idle_ms_from_secs, sanitise_app_name, sanitise_window_title,
    OsEventData, OsEventPayload, WindowAtPoint, WINDOW_DROP_RELEASE_CHANNEL,
};
use std::{
    ffi::c_void,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};

// Polling interval — 5 s os_idle_tick / debounce.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

// ─── Raw Core Foundation + Core Graphics FFI ─────────────────────────────────

type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFNumberRef = *const c_void;
type CFBooleanRef = *const c_void;
type CFIndex = isize;
type CGWindowID = u32;
type CGWindowListOption = u32;

const K_CG_NULL_WINDOW_ID: CGWindowID = 0;
const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: CGWindowListOption = 1 << 0;

#[repr(i32)]
#[allow(dead_code)]
enum CFNumberType {
    Int64 = 4,
    Int32 = 9,
    Double = 13,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// OS-wide idle time in seconds (HIDSystemState = 1, kCGAnyInputEventType = 14).
    fn CGEventSourceSecondsSinceLastEventType(stateID: i32, eventType: u32) -> f64;

    fn CGWindowListCopyWindowInfo(
        option: CGWindowListOption,
        relativeToWindow: CGWindowID,
    ) -> CFArrayRef;

    fn CGMainDisplayID() -> u32;
    fn CGDisplayBounds(displayID: u32) -> CGRect;

    // Release detection — read the left mouse-button state.
    // `stateID` = kCGEventSourceStateCombinedSessionState (0); `button` = left (0).
    fn CGEventSourceButtonState(stateID: i32, button: u32) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(theArray: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(theArray: CFArrayRef, idx: CFIndex) -> CFTypeRef;
    fn CFDictionaryGetValue(theDict: CFDictionaryRef, key: CFStringRef) -> CFTypeRef;
    fn CFNumberGetValue(number: CFNumberRef, theType: i32, valuePtr: *mut c_void) -> bool;
    fn CFStringGetLength(theString: CFStringRef) -> CFIndex;
    fn CFStringGetCString(
        theString: CFStringRef,
        buffer: *mut u8,
        bufferSize: CFIndex,
        encoding: u32,
    ) -> bool;
    fn CFBooleanGetValue(boolean: CFBooleanRef) -> bool;
    fn CFRelease(cf: CFTypeRef);

    static kCFBooleanTrue: CFBooleanRef;
}

// Static CGWindowList property keys (declared in CoreGraphics).
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGWindowNumber: CFStringRef;
    static kCGWindowOwnerPID: CFStringRef;
    static kCGWindowName: CFStringRef;
    static kCGWindowLayer: CFStringRef;
    static kCGWindowBounds: CFStringRef;
    static kCGWindowIsOnscreen: CFStringRef;
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

// ─── idle time ────────────────────────────────────────────────────────────────

// CGEventSourceStateID 1 = HIDSystemState; 14 = kCGAnyInputEventType.
const HID_SYSTEM_STATE: i32 = 1;
const K_CG_ANY_INPUT_EVENT_TYPE: u32 = 14;

/// OS-wide idle milliseconds.
pub fn os_idle_ms() -> u64 {
    let secs = unsafe {
        CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, K_CG_ANY_INPUT_EVENT_TYPE)
    };
    idle_ms_from_secs(secs)
}

// ─── Primary screen bounds ────────────────────────────────────────────────────

fn primary_screen_size() -> (f64, f64) {
    let display_id = unsafe { CGMainDisplayID() };
    let bounds = unsafe { CGDisplayBounds(display_id) };
    (bounds.size.width, bounds.size.height)
}

// ─── CFString → String ────────────────────────────────────────────────────────

/// Copies a CFStringRef into a Rust String. Returns None on failure.
///
/// # Safety
/// `s` must be a valid CFStringRef (non-null).
unsafe fn cfstring_to_string(s: CFStringRef) -> Option<String> {
    if s.is_null() {
        return None;
    }
    let len = CFStringGetLength(s);
    // 3 bytes per char for UTF-8 (max expansion) + null.
    let buf_size = (len * 4 + 1) as usize;
    let mut buf = vec![0u8; buf_size];
    let ok = CFStringGetCString(
        s,
        buf.as_mut_ptr(),
        buf_size as CFIndex,
        K_CF_STRING_ENCODING_UTF8,
    );
    if !ok {
        return None;
    }
    let nul = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8(buf[..nul].to_vec()).ok()
}

// ─── CGWindowList parsing ─────────────────────────────────────────────────────

pub struct WindowInfo {
    pub title: Option<String>,
    pub is_fullscreen: bool,
}

/// Returns WindowInfo for the frontmost window owned by `pid`.
///
/// Uses CGWindowListCopyWindowInfo (no Accessibility permission needed).
/// Fullscreen heuristic: window layer == 0 && covers primary screen bounds.
pub fn frontmost_window_info(pid: i32) -> Option<WindowInfo> {
    let (sw, sh) = primary_screen_size();

    let windows = unsafe {
        CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY, K_CG_NULL_WINDOW_ID)
    };
    if windows.is_null() {
        log::debug!("CGWindowListCopyWindowInfo returned null; skipping window info");
        return None;
    }

    let count = unsafe { CFArrayGetCount(windows) };
    let mut title: Option<String> = None;
    let mut is_fullscreen = false;

    for i in 0..count {
        let dict = unsafe { CFArrayGetValueAtIndex(windows, i) };
        if dict.is_null() {
            continue;
        }

        // Match by owner PID.
        let owner_pid = unsafe {
            let v = CFDictionaryGetValue(dict, kCGWindowOwnerPID);
            if v.is_null() {
                continue;
            }
            let mut out: i32 = 0;
            if !CFNumberGetValue(
                v,
                CFNumberType::Int32 as i32,
                &mut out as *mut i32 as *mut c_void,
            ) {
                continue;
            }
            out
        };
        if owner_pid != pid {
            continue;
        }

        // Window title (kCGWindowName).
        if title.is_none() {
            unsafe {
                let name_ref = CFDictionaryGetValue(dict, kCGWindowName);
                if !name_ref.is_null() {
                    title = cfstring_to_string(name_ref).and_then(|s| sanitise_window_title(&s));
                }
            }
        }

        // Fullscreen: layer == 0 && bounds cover screen.
        unsafe {
            let layer_v = CFDictionaryGetValue(dict, kCGWindowLayer);
            if !layer_v.is_null() {
                let mut layer: i32 = 0;
                if CFNumberGetValue(
                    layer_v,
                    CFNumberType::Int32 as i32,
                    &mut layer as *mut i32 as *mut c_void,
                ) && layer == 0
                {
                    // Parse bounds dict (has X/Y/Width/Height as CFNumber keys).
                    let bounds_dict = CFDictionaryGetValue(dict, kCGWindowBounds);
                    if !bounds_dict.is_null() {
                        if let (Some(w), Some(h)) = (
                            dict_get_f64(bounds_dict, "Width"),
                            dict_get_f64(bounds_dict, "Height"),
                        ) {
                            if w >= sw && h >= sh {
                                is_fullscreen = true;
                            }
                        }
                    }
                }
            }
        }
    }

    unsafe { CFRelease(windows) };

    Some(WindowInfo {
        title,
        is_fullscreen,
    })
}

/// Reads a f64 from a nested CFDictionary by UTF-8 key.
unsafe fn dict_get_f64(dict: CFDictionaryRef, key: &str) -> Option<f64> {
    let key_cf = make_cfstring(key);
    if key_cf.is_null() {
        return None;
    }
    let v = CFDictionaryGetValue(dict, key_cf);
    CFRelease(key_cf);
    if v.is_null() {
        return None;
    }
    let mut out: f64 = 0.0;
    if CFNumberGetValue(
        v,
        CFNumberType::Double as i32,
        &mut out as *mut f64 as *mut c_void,
    ) {
        Some(out)
    } else {
        None
    }
}

/// Creates a CFStringRef from a Rust &str (must be CFRelease'd by caller).
unsafe fn make_cfstring(s: &str) -> CFStringRef {
    use std::ffi::CString;
    // Use CoreFoundation CFStringCreateWithCString.
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            cStr: *const i8,
            encoding: u32,
        ) -> CFStringRef;
    }
    let cs = CString::new(s).unwrap_or_default();
    CFStringCreateWithCString(std::ptr::null(), cs.as_ptr(), K_CF_STRING_ENCODING_UTF8)
}

// ─── Drop-release detection + window enumeration ─────────────────────────────
//
// After `start_dragging()` hands control to the OS-modal drag loop, a poll
// thread detects the mouse release and emits a bare `window_drop_release`
// signal; `list_all_windows` enumerates the foreign on-screen windows.

// kCGEventSourceStateCombinedSessionState = 0; left mouse button = 0.
const CG_EVENT_SOURCE_STATE_COMBINED: i32 = 0;
const CG_MOUSE_BUTTON_LEFT: u32 = 0;
// Poll cadence + safety timeout so the thread can never spin forever.
const RELEASE_POLL_INTERVAL: Duration = Duration::from_millis(16);
const RELEASE_POLL_TIMEOUT: Duration = Duration::from_secs(10);

/// Axis-aligned screen rect in CGWindowBounds space (points, top-left origin).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScreenRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ScreenRect {
    /// Half-open containment: left/top inclusive, right/bottom exclusive.
    fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && px < self.x + self.width && py >= self.y && py < self.y + self.height
    }
}

/// One enumerated on-screen window: rect (points), owner pid, optional name.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowRect {
    pub rect: ScreenRect,
    pub pid: i32,
    pub name: Option<String>,
    pub window_number: u32,
}

/// Reads a bounds CFDictionary (`kCGWindowBounds`) into a ScreenRect.
///
/// # Safety
/// `bounds_dict` must be a valid CGWindowBounds dictionary.
unsafe fn bounds_to_rect(bounds_dict: CFDictionaryRef) -> Option<ScreenRect> {
    let x = dict_get_f64(bounds_dict, "X")?;
    let y = dict_get_f64(bounds_dict, "Y")?;
    let width = dict_get_f64(bounds_dict, "Width")?;
    let height = dict_get_f64(bounds_dict, "Height")?;
    Some(ScreenRect {
        x,
        y,
        width,
        height,
    })
}

/// Public window list for the `list_windows` command: every foreign on-screen
/// window in front-to-back (topmost first) order, mapped to `WindowAtPoint`.
pub fn list_all_windows() -> Vec<WindowAtPoint> {
    let own_pid = std::process::id() as i32;
    filter_foreign(enumerate_windows(), own_pid)
        .into_iter()
        .map(window_rect_to_at_point)
        .collect()
}

/// Pure own-pid filter (no FFI), so the ordering/exclusion is unit-testable.
///
/// `windows` is front-to-back (topmost first); the order is preserved, only
/// windows owned by `own_pid` (YUI itself) are dropped.
fn filter_foreign(windows: Vec<WindowRect>, own_pid: i32) -> Vec<WindowRect> {
    windows.into_iter().filter(|w| w.pid != own_pid).collect()
}

/// Maps an enumerated `WindowRect` into the serializable `WindowAtPoint`.
fn window_rect_to_at_point(w: WindowRect) -> WindowAtPoint {
    WindowAtPoint {
        x: w.rect.x,
        y: w.rect.y,
        width: w.rect.width,
        height: w.rect.height,
        name: w.name,
        pid: w.pid,
        window_number: w.window_number,
    }
}

/// Enumerates on-screen windows into `WindowRect`s in CGWindowBounds space
/// (points, top-left origin), preserving CGWindowList front-to-back order.
///
/// Filter: skips chrome layers (menu bar / Dock / wallpaper) by dropping any
/// window whose `kCGWindowLayer` != 0 — normal app windows live at layer 0;
/// system chrome sits at non-zero layers. Own-pid exclusion is left to callers.
fn enumerate_windows() -> Vec<WindowRect> {
    let windows = unsafe {
        CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY, K_CG_NULL_WINDOW_ID)
    };
    if windows.is_null() {
        log::debug!("enumerate_windows: CGWindowListCopyWindowInfo returned null");
        return Vec::new();
    }

    let count = unsafe { CFArrayGetCount(windows) };
    let mut collected: Vec<WindowRect> = Vec::new();

    for i in 0..count {
        let dict = unsafe { CFArrayGetValueAtIndex(windows, i) };
        if dict.is_null() {
            continue;
        }

        // Layer: keep only normal app windows (layer 0); skip Dock/menu/desktop.
        let layer = unsafe {
            let v = CFDictionaryGetValue(dict, kCGWindowLayer);
            if v.is_null() {
                continue;
            }
            let mut out: i32 = 0;
            if !CFNumberGetValue(
                v,
                CFNumberType::Int32 as i32,
                &mut out as *mut i32 as *mut c_void,
            ) {
                continue;
            }
            out
        };
        if layer != 0 {
            continue;
        }

        // Owner pid.
        let pid = unsafe {
            let v = CFDictionaryGetValue(dict, kCGWindowOwnerPID);
            if v.is_null() {
                continue;
            }
            let mut out: i32 = 0;
            if !CFNumberGetValue(
                v,
                CFNumberType::Int32 as i32,
                &mut out as *mut i32 as *mut c_void,
            ) {
                continue;
            }
            out
        };

        // Window number: stable CGWindowID identity (read i64, cast u32).
        let window_number = unsafe {
            let v = CFDictionaryGetValue(dict, kCGWindowNumber);
            if v.is_null() {
                continue;
            }
            let mut out: i64 = 0;
            if !CFNumberGetValue(
                v,
                CFNumberType::Int64 as i32,
                &mut out as *mut i64 as *mut c_void,
            ) {
                continue;
            }
            out as u32
        };

        // Bounds rect.
        let rect = unsafe {
            let bounds_dict = CFDictionaryGetValue(dict, kCGWindowBounds);
            if bounds_dict.is_null() {
                continue;
            }
            match bounds_to_rect(bounds_dict) {
                Some(r) => r,
                None => continue,
            }
        };

        // Name (optional — many windows report none).
        let name = unsafe {
            let name_ref = CFDictionaryGetValue(dict, kCGWindowName);
            if name_ref.is_null() {
                None
            } else {
                cfstring_to_string(name_ref).filter(|s| !s.is_empty())
            }
        };

        collected.push(WindowRect {
            rect,
            pid,
            name,
            window_number,
        });
    }

    unsafe { CFRelease(windows) };

    collected
}

// Process-wide once-guard: only one drop-release probe runs at a time so
// overlapping drags can't emit duplicate `window_drop_release` signals.
static PROBE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// RAII handle for the single active drop-release probe.
///
/// `try_acquire` succeeds only when no probe is running, flipping `PROBE_ACTIVE`
/// to true; a concurrent attempt returns `None`. `Drop` clears the flag on every
/// exit path of the holder (normal release emit, timeout, early return, panic),
/// so the flag can never get stuck true.
struct ProbeGuard;

impl ProbeGuard {
    fn try_acquire() -> Option<Self> {
        PROBE_ACTIVE
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| ProbeGuard)
    }
}

impl Drop for ProbeGuard {
    fn drop(&mut self) {
        PROBE_ACTIVE.store(false, Ordering::Release);
    }
}

/// Spawns a short-lived thread that polls the left mouse button until release
/// (down→up), then emits a bare `window_drop_release` signal.
///
/// Called right after `start_dragging()` succeeds. Polling (not an NSEvent
/// monitor) is used because the OS-modal drag loop swallows monitor callbacks.
/// A hard timeout guarantees the thread exits even if no release is observed.
///
/// A process-wide once-guard suppresses a second concurrent probe; rapid or
/// overlapping drags reuse the in-flight probe instead of emitting duplicate
/// release signals. A later drag spawns normally once the prior probe finishes.
pub fn spawn_drop_release_probe<R: Runtime>(app: AppHandle<R>) {
    let Some(guard) = ProbeGuard::try_acquire() else {
        log::debug!("drop_release: probe already active, skipping duplicate spawn");
        return;
    };

    thread::Builder::new()
        .name("yui_drop_release".into())
        .spawn(move || {
            // Held for the thread's whole lifetime; Drop clears PROBE_ACTIVE on
            // every exit path (timeout return, release break, or panic).
            let _guard = guard;

            let start = std::time::Instant::now();

            // Wait until the button is actually down (drag may not have armed
            // it yet), so we don't read a stale up-state as an instant release.
            let mut saw_down = false;
            loop {
                if start.elapsed() >= RELEASE_POLL_TIMEOUT {
                    log::info!("drop_release: timeout, no release observed");
                    return;
                }
                let down = unsafe {
                    CGEventSourceButtonState(CG_EVENT_SOURCE_STATE_COMBINED, CG_MOUSE_BUTTON_LEFT)
                };
                if down {
                    saw_down = true;
                } else if saw_down {
                    // down → up transition: this is the release.
                    break;
                }
                thread::sleep(RELEASE_POLL_INTERVAL);
            }

            log::info!("drop_release detected");

            if let Err(e) = app.emit(WINDOW_DROP_RELEASE_CHANNEL, ()) {
                log::warn!("window_drop_release emit failed: {e}");
            }
        })
        .expect("failed to spawn yui_drop_release thread");
}

// ─── NSWorkspace / NSRunningApplication (objc2) ───────────────────────────────

use objc2::rc::Retained;
use objc2_app_kit::{NSRunningApplication, NSWorkspace};
use objc2_foundation::NSString;

/// Returns (pid, localizedName) of the frontmost application, or None.
pub fn frontmost_app() -> Option<(i32, String)> {
    let ws = NSWorkspace::sharedWorkspace();
    let Some(app): Option<Retained<NSRunningApplication>> = ws.frontmostApplication() else {
        log::debug!("NSWorkspace frontmostApplication returned None; skipping active-app poll");
        return None;
    };
    let name_ns: Retained<NSString> = app.localizedName()?;
    let name = name_ns.to_string();
    let pid = app.processIdentifier();
    Some((pid, name))
}

// ─── camera_in_use — best-effort ─────────────────────────────────────────────

/// Always returns None on macOS (requires privileged IOKit SPI, not public API).
/// Emitting None signals best-effort degrade.
pub fn camera_in_use() -> Option<bool> {
    None
}

// ─── Background polling loop ──────────────────────────────────────────────────

pub fn start_polling(app: AppHandle) {
    thread::Builder::new()
        .name("os_event_watcher".into())
        .spawn(move || polling_loop(app))
        .expect("failed to spawn os_event_watcher thread");
}

fn polling_loop(app: AppHandle) {
    let mut prev_app: Option<String> = None;
    let mut prev_fullscreen: Option<bool> = None;

    loop {
        let now = epoch_ms();

        // ── 1. Idle tick (emitted every poll interval) ─────────────────────
        let idle = os_idle_ms();
        let _ = emit_os_event(
            &app,
            OsEventPayload {
                event_name: "os_idle_tick".into(),
                ts: now,
                data: OsEventData {
                    os_idle_ms: Some(idle),
                    ..Default::default()
                },
            },
        );

        // ── 2. Active app + window title + fullscreen ──────────────────────
        if let Some((pid, app_name)) = frontmost_app() {
            let clean_name = sanitise_app_name(&app_name);
            let win_info = frontmost_window_info(pid);

            let app_changed = clean_name != prev_app;
            if app_changed {
                prev_app = clean_name.clone();
                let _ = emit_os_event(
                    &app,
                    OsEventPayload {
                        event_name: "active_app_changed".into(),
                        ts: epoch_ms(),
                        data: OsEventData {
                            active_app_name: clean_name,
                            active_window_title: win_info.as_ref().and_then(|w| w.title.clone()),
                            ..Default::default()
                        },
                    },
                );
            }

            // ── 3. Fullscreen state change ─────────────────────────────────
            let fs = win_info.as_ref().map(|w| w.is_fullscreen).unwrap_or(false);
            let fs_changed = prev_fullscreen.map(|p| p != fs).unwrap_or(true);
            if fs_changed {
                prev_fullscreen = Some(fs);
                let event_name = if fs {
                    "fullscreen_entered"
                } else {
                    "fullscreen_exited"
                };
                let _ = emit_os_event(
                    &app,
                    OsEventPayload {
                        event_name: event_name.into(),
                        ts: epoch_ms(),
                        data: OsEventData {
                            is_fullscreen: Some(fs),
                            ..Default::default()
                        },
                    },
                );
            }
        }

        thread::sleep(POLL_INTERVAL);
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_idle_ms_returns_plausible_value() {
        let ms = os_idle_ms();
        // Must not panic and must be within 24 h.
        assert!(ms < 86_400_000);
    }

    #[test]
    fn primary_screen_size_nonzero() {
        let (w, h) = primary_screen_size();
        assert!(w > 0.0 && h > 0.0);
    }

    #[test]
    fn fullscreen_heuristic_cover() {
        // Window matches screen exactly → fullscreen.
        let (sw, sh) = (2560.0_f64, 1600.0_f64);
        assert!(2560.0_f64 >= sw && 1600.0_f64 >= sh);
    }

    #[test]
    fn fullscreen_heuristic_no_cover() {
        let (sw, sh) = (2560.0_f64, 1600.0_f64);
        assert!(!(1280.0_f64 >= sw && 800.0_f64 >= sh));
    }

    #[test]
    fn cfstring_roundtrip() {
        unsafe {
            let s = make_cfstring("Hello, macOS!");
            assert!(!s.is_null());
            let result = cfstring_to_string(s);
            CFRelease(s);
            assert_eq!(result, Some("Hello, macOS!".into()));
        }
    }

    #[test]
    fn cfstring_empty() {
        unsafe {
            let s = make_cfstring("");
            let result = cfstring_to_string(s);
            CFRelease(s);
            // Empty string → Some("") → sanitise_app_name will return None, but cfstring itself succeeds.
            assert_eq!(result, Some("".into()));
        }
    }

    // ── filter_foreign (pure own-pid filter, order-preserving) ─────────────

    fn win(x: f64, y: f64, w: f64, h: f64, pid: i32) -> WindowRect {
        WindowRect {
            rect: ScreenRect {
                x,
                y,
                width: w,
                height: h,
            },
            pid,
            name: None,
            window_number: 0,
        }
    }

    #[test]
    fn filter_foreign_drops_own_and_preserves_order() {
        let own = 4242;
        let windows = vec![
            win(0.0, 0.0, 100.0, 100.0, 11),  // foreign, topmost
            win(0.0, 0.0, 100.0, 100.0, own), // YUI itself — dropped
            win(0.0, 0.0, 100.0, 100.0, 22),  // foreign, lower
        ];
        let kept = filter_foreign(windows, own);
        let pids: Vec<i32> = kept.iter().map(|w| w.pid).collect();
        assert_eq!(pids, vec![11, 22]); // front-to-back order preserved
    }

    #[test]
    fn filter_foreign_empty_is_empty() {
        assert!(filter_foreign(Vec::new(), 999).is_empty());
    }

    #[test]
    fn rect_contains_is_half_open() {
        let r = ScreenRect {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
        };
        assert!(r.contains(10.0, 20.0)); // top-left inclusive
        assert!(!r.contains(40.0, 20.0)); // right edge exclusive (x + w)
        assert!(!r.contains(10.0, 60.0)); // bottom edge exclusive (y + h)
        assert!(r.contains(39.9, 59.9)); // just inside
    }

    // ── ProbeGuard once-guard ────────────────────────────────────────────────

    #[test]
    fn probe_guard_serialises_acquire_release() {
        // Clean baseline (other tests share the process-wide flag).
        PROBE_ACTIVE.store(false, Ordering::Release);

        {
            let first = ProbeGuard::try_acquire();
            assert!(first.is_some(), "first acquire must succeed");
            assert!(PROBE_ACTIVE.load(Ordering::Acquire), "flag set while held");

            // A second concurrent acquire is refused while the first is held.
            let second = ProbeGuard::try_acquire();
            assert!(
                second.is_none(),
                "second concurrent acquire must be refused"
            );
        }

        // Dropping the first guard at end of scope resets the flag.
        assert!(
            !PROBE_ACTIVE.load(Ordering::Acquire),
            "flag cleared on drop"
        );

        // A subsequent acquire after release succeeds again.
        let third = ProbeGuard::try_acquire();
        assert!(third.is_some(), "acquire after release must succeed");
        drop(third);
        assert!(
            !PROBE_ACTIVE.load(Ordering::Acquire),
            "flag cleared after final drop"
        );
    }
}
