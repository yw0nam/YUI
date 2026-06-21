//! Click-through toggle — sets `set_ignore_cursor_events` on the top-level window
//! and, on Windows, propagates `WS_EX_TRANSPARENT` to all WebView2 child HWNDs so
//! mouse input falls through the transparent overlay to the desktop behind it.

use tauri::{command, Runtime, WebviewWindow};

/// `WS_EX_TRANSPARENT` bit (Win32 EXSTYLE flag 0x00000020).
const WS_EX_TRANSPARENT: u32 = 0x0000_0020;

/// Returns the desired `GWL_EXSTYLE` value: sets `transparent_bit` when `ignore`,
/// clears it otherwise, preserving all other bits.
///
/// Extracted so the logic is testable without any FFI dependency.
pub(crate) fn desired_exstyle(current: u32, ignore: bool, transparent_bit: u32) -> u32 {
    if ignore {
        current | transparent_bit
    } else {
        current & !transparent_bit
    }
}

/// Toggles click-through on the webview window.
///
/// Always calls `set_ignore_cursor_events` on the top-level window. On Windows,
/// also walks every child HWND (WebView2 subtree) and syncs `WS_EX_TRANSPARENT`
/// so mouse events are not intercepted by the child windows before they reach the
/// desktop compositor.
#[command]
pub fn set_click_through<R: Runtime>(
    window: WebviewWindow<R>,
    ignore: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        windows_set_children_transparent(&window, ignore).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ─── Windows-only FFI ────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    use super::{desired_exstyle, WS_EX_TRANSPARENT};
    use windows::{
        Win32::{
            Foundation::{HWND, LPARAM},
            UI::WindowsAndMessaging::{
                EnumChildWindows, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
            },
        },
        core::BOOL,
    };

    /// Payload threaded through the `EnumChildWindows` callback via `LPARAM`.
    struct EnumPayload {
        ignore: bool,
    }

    /// `EnumChildWindows` callback: reads current EXSTYLE, applies the desired
    /// transparent-bit mask, and writes it back.
    ///
    /// # Safety
    /// Called by Win32 with a valid child HWND. `lparam` holds a raw pointer to
    /// `EnumPayload` allocated on the calling stack — the callback runs
    /// synchronously on the same thread, so the reference is valid for the
    /// duration of the callback.
    unsafe extern "system" fn enum_child_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let payload = &*(lparam.0 as *const EnumPayload);
        // SAFETY: GWL_EXSTYLE query is always valid for any top-level or child window.
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let desired = desired_exstyle(current, payload.ignore, WS_EX_TRANSPARENT);
        if desired != current {
            // SAFETY: SetWindowLongPtrW is safe for GWL_EXSTYLE on a valid HWND.
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired as isize);
        }
        BOOL(1) // continue enumeration
    }

    /// Walk all child HWNDs under `parent` and apply the click-through EXSTYLE.
    pub(super) fn apply_children(parent: HWND, ignore: bool) {
        let payload = EnumPayload { ignore };
        // SAFETY: `enum_child_proc` is a valid callback; `&payload` is valid for
        // the synchronous duration of EnumChildWindows.
        unsafe {
            let _ = EnumChildWindows(
                Some(parent),
                Some(enum_child_proc),
                LPARAM(&payload as *const EnumPayload as isize),
            );
        }
    }
}

/// Applies `WS_EX_TRANSPARENT` to all child HWNDs of the top-level window.
#[cfg(target_os = "windows")]
fn windows_set_children_transparent<R: Runtime>(
    window: &WebviewWindow<R>,
    ignore: bool,
) -> tauri::Result<()> {
    use windows::Win32::Foundation::HWND;

    let hwnd_raw = window.hwnd()?.0;
    let parent = HWND(hwnd_raw);
    win::apply_children(parent, ignore);
    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── desired_exstyle — pure logic, no FFI, runs on any host platform ──────

    #[test]
    fn ignore_true_sets_transparent_bit() {
        let result = desired_exstyle(0x0000_0000, true, WS_EX_TRANSPARENT);
        assert_eq!(result & WS_EX_TRANSPARENT, WS_EX_TRANSPARENT);
    }

    #[test]
    fn ignore_false_clears_transparent_bit() {
        // Start with the bit already set; ignore=false must clear it.
        let result = desired_exstyle(WS_EX_TRANSPARENT, false, WS_EX_TRANSPARENT);
        assert_eq!(result & WS_EX_TRANSPARENT, 0);
    }

    #[test]
    fn other_bits_preserved_when_setting() {
        let other: u32 = 0x0000_0008; // some unrelated EXSTYLE bit
        let current = other;
        let result = desired_exstyle(current, true, WS_EX_TRANSPARENT);
        assert_eq!(result & other, other, "other bits must be preserved");
        assert_eq!(result & WS_EX_TRANSPARENT, WS_EX_TRANSPARENT);
    }

    #[test]
    fn other_bits_preserved_when_clearing() {
        let other: u32 = 0x0000_0008;
        let current = other | WS_EX_TRANSPARENT;
        let result = desired_exstyle(current, false, WS_EX_TRANSPARENT);
        assert_eq!(result & other, other, "other bits must be preserved");
        assert_eq!(result & WS_EX_TRANSPARENT, 0);
    }

    #[test]
    fn idempotent_when_bit_already_set() {
        let current = WS_EX_TRANSPARENT | 0x0000_0008;
        let result = desired_exstyle(current, true, WS_EX_TRANSPARENT);
        assert_eq!(result, current, "idempotent: already-set bit unchanged");
    }

    #[test]
    fn idempotent_when_bit_already_cleared() {
        let current: u32 = 0x0000_0008; // transparent bit absent
        let result = desired_exstyle(current, false, WS_EX_TRANSPARENT);
        assert_eq!(result, current, "idempotent: already-clear bit unchanged");
    }
}
