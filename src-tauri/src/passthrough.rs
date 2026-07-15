//! Click-through toggle — sets `set_ignore_cursor_events` on the top-level window
//! and, on Windows, adds `WS_EX_TRANSPARENT` to the WebView2 child HWNDs so mouse
//! input falls through the transparent overlay to the window behind it. Each child's
//! baseline style is restored on release, so WebView2's render windows (which carry
//! the bit natively) keep it instead of being blanked.

use tauri::{command, Runtime, WebviewWindow};

/// `WS_EX_TRANSPARENT` bit (Win32 EXSTYLE flag 0x00000020).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const WS_EX_TRANSPARENT: u32 = 0x0000_0020;

/// Desired `GWL_EXSTYLE` for a child given its BASELINE style (the style it had
/// before we first touched it): passthrough adds `transparent_bit`, capture
/// restores the baseline exactly.
///
/// Restoring the baseline rather than clearing the bit is essential — WebView2's
/// DirectComposition render windows carry `WS_EX_TRANSPARENT` natively, and
/// stripping it blanks the rendered surface. Extracted so the logic is testable
/// without any FFI dependency.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn desired_exstyle(baseline: u32, ignore: bool, transparent_bit: u32) -> u32 {
    if ignore {
        baseline | transparent_bit
    } else {
        baseline
    }
}

/// Toggles click-through on the webview window.
///
/// Always calls `set_ignore_cursor_events` on the top-level window. On Windows,
/// also walks every child HWND (WebView2 subtree) and syncs `WS_EX_TRANSPARENT`
/// so mouse events are not intercepted by the child windows before they reach the
/// desktop compositor.
#[command]
pub fn set_click_through<R: Runtime>(window: WebviewWindow<R>, ignore: bool) -> Result<(), String> {
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
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use windows::{
        core::BOOL,
        Win32::{
            Foundation::{HWND, LPARAM},
            UI::WindowsAndMessaging::{
                EnumChildWindows, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
            },
        },
    };

    /// Per-HWND baseline EXSTYLE, captured the first time we touch a child so capture
    /// can restore it exactly instead of stripping a natively-present transparent bit.
    fn baselines() -> &'static Mutex<HashMap<isize, u32>> {
        static B: OnceLock<Mutex<HashMap<isize, u32>>> = OnceLock::new();
        B.get_or_init(|| Mutex::new(HashMap::new()))
    }

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
        // Baseline = the child's native style, captured the first time we see it.
        // Restoring to it on capture avoids stripping WS_EX_TRANSPARENT from WebView2's
        // render windows (which carry it natively and blank without it).
        let baseline = *baselines()
            .lock()
            .unwrap()
            .entry(hwnd.0 as isize)
            .or_insert(current);
        let desired = desired_exstyle(baseline, payload.ignore, WS_EX_TRANSPARENT);
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

    // ── desired_exstyle — pure logic, no FFI (Windows-only: the bit-mask helper
    //    is compiled only on Windows, so its tests are gated the same way). ──────

    #[test]
    fn passthrough_adds_transparent_bit() {
        let result = desired_exstyle(0x0000_0008, true, WS_EX_TRANSPARENT);
        assert_eq!(result, 0x0000_0008 | WS_EX_TRANSPARENT);
    }

    #[test]
    fn capture_restores_baseline() {
        // Baseline lacks the bit; capture returns it unchanged.
        let result = desired_exstyle(0x0000_0008, false, WS_EX_TRANSPARENT);
        assert_eq!(result, 0x0000_0008);
    }

    #[test]
    fn capture_keeps_natively_present_bit() {
        // A WebView2 render window whose baseline natively carries WS_EX_TRANSPARENT
        // must keep it on capture — stripping it blanks the DirectComposition surface.
        let baseline = WS_EX_TRANSPARENT | 0x0008_0000; // + WS_EX_LAYERED
        let result = desired_exstyle(baseline, false, WS_EX_TRANSPARENT);
        assert_eq!(result, baseline);
    }

    #[test]
    fn passthrough_preserves_other_bits() {
        let result = desired_exstyle(0x0004_0000, true, WS_EX_TRANSPARENT);
        assert_eq!(
            result & 0x0004_0000,
            0x0004_0000,
            "other bits must be preserved"
        );
        assert_eq!(result & WS_EX_TRANSPARENT, WS_EX_TRANSPARENT);
    }

    #[test]
    fn passthrough_idempotent_when_baseline_has_bit() {
        let baseline = WS_EX_TRANSPARENT | 0x0000_0008;
        let result = desired_exstyle(baseline, true, WS_EX_TRANSPARENT);
        assert_eq!(
            result, baseline,
            "idempotent: already-present bit unchanged"
        );
    }
}
