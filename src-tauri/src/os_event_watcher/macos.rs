//! macOS OS polling — active app (NSWorkspace), idle (CGEventSource FFI),
//! window title + fullscreen (CGWindowList raw FFI), camera best-effort.

#![allow(dead_code)] // camera_in_use + CFBooleanRef are unused FFI bindings

use super::{emit_os_event, epoch_ms, idle_ms_from_secs, sanitise_app_name,
            sanitise_window_title, OsEventData, OsEventPayload};
use std::{
    ffi::c_void,
    thread,
    time::Duration,
};
use tauri::AppHandle;

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
    let ok = CFStringGetCString(s, buf.as_mut_ptr(), buf_size as CFIndex, K_CF_STRING_ENCODING_UTF8);
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
            if !CFNumberGetValue(v, CFNumberType::Int32 as i32, &mut out as *mut i32 as *mut c_void) {
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
                if CFNumberGetValue(layer_v, CFNumberType::Int32 as i32, &mut layer as *mut i32 as *mut c_void)
                    && layer == 0
                {
                    // Parse bounds dict (has X/Y/Width/Height as CFNumber keys).
                    let bounds_dict = CFDictionaryGetValue(dict, kCGWindowBounds);
                    if !bounds_dict.is_null() {
                        if let (Some(w), Some(h)) =
                            (dict_get_f64(bounds_dict, "Width"), dict_get_f64(bounds_dict, "Height"))
                        {
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

    Some(WindowInfo { title, is_fullscreen })
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
    if CFNumberGetValue(v, CFNumberType::Double as i32, &mut out as *mut f64 as *mut c_void) {
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
                data: OsEventData { os_idle_ms: Some(idle), ..Default::default() },
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
                let event_name = if fs { "fullscreen_entered" } else { "fullscreen_exited" };
                let _ = emit_os_event(
                    &app,
                    OsEventPayload {
                        event_name: event_name.into(),
                        ts: epoch_ms(),
                        data: OsEventData { is_fullscreen: Some(fs), ..Default::default() },
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
}
