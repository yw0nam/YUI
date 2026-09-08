//! Lifts AppKit's `constrainFrameRect:toScreen:` on the pet window (macOS only), the same
//! way Electron's frameless-window NSWindow subclass does — otherwise a move whose frame
//! still overlaps the monitor it started on is clamped there, however far off-screen the
//! target actually is, which stalls a screen-edge climb right at the menu bar.

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CString;
    use std::sync::OnceLock;

    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::sel;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::NSRect;

    /// Returns the incoming frame unchanged, so the window is never constrained to a screen.
    extern "C-unwind" fn constrain_frame_rect_to_screen(
        _this: &AnyObject,
        _sel: Sel,
        frame: NSRect,
        _screen: *const NSScreen,
    ) -> NSRect {
        frame
    }

    /// A runtime subclass of `superclass` whose `constrainFrameRect:toScreen:` is a no-op.
    /// Built once; `None` if registration ever fails (a class of that name already exists).
    fn unconstrained_subclass(superclass: &AnyClass) -> Option<&'static AnyClass> {
        static CLASS: OnceLock<Option<&'static AnyClass>> = OnceLock::new();
        *CLASS.get_or_init(|| {
            let name = CString::new("YuiUnconstrainedWindow").ok()?;
            let mut builder = ClassBuilder::new(&name, superclass)?;
            // SAFETY: the replacement has the same receiver/selector/argument/return
            // types as AppKit's own `constrainFrameRect:toScreen:`.
            unsafe {
                builder.add_method(
                    sel!(constrainFrameRect:toScreen:),
                    constrain_frame_rect_to_screen as extern "C-unwind" fn(_, _, _, _) -> _,
                );
            }
            Some(builder.register())
        })
    }

    /// Swaps `window`'s NSWindow to a subclass that never constrains its frame to a
    /// screen. Best-effort: logs and does nothing if the NSWindow or the subclass is
    /// unavailable, rather than failing app startup over a display quirk.
    pub fn allow_unconstrained_frame(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        let ns_window = match window.ns_window() {
            Ok(ptr) => ptr,
            Err(err) => {
                log::warn!("allow_unconstrained_frame: no NSWindow: {err}");
                return Ok(());
            }
        };
        // SAFETY: `ns_window` is the pet window's own NSWindow for as long as the window
        // is alive, which outlives this call; we only read its class and swap it.
        let obj = unsafe { &*(ns_window as *const AnyObject) };
        let superclass = obj.class();
        let Some(subclass) = unconstrained_subclass(superclass) else {
            log::warn!(
                "allow_unconstrained_frame: failed to register the unconstrained-frame subclass"
            );
            return Ok(());
        };
        // SAFETY: the subclass adds no ivars and overrides one method with a
        // signature-compatible replacement, so the instance size and layout are unchanged.
        unsafe {
            AnyObject::set_class(obj, subclass);
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub use macos::allow_unconstrained_frame;

/// No-op off macOS — AppKit's frame constraint has no equivalent elsewhere.
#[cfg(not(target_os = "macos"))]
pub fn allow_unconstrained_frame(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
