//! Lifts AppKit's `constrainFrameRect:toScreen:` on the pet window (macOS only), the same
//! way Electron's frameless-window NSWindow subclass does — otherwise a move whose frame
//! still overlaps the monitor it started on is clamped there, however far off-screen the
//! target actually is, which stalls a screen-edge climb right at the menu bar.

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CString;
    use std::sync::mpsc;
    use std::sync::OnceLock;

    use objc2::ffi::{class_addMethod, class_getInstanceMethod, method_setImplementation};
    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{sel, MainThreadMarker};
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use tauri::{Runtime, WebviewWindow};

    /// Returns the incoming frame unchanged, so the window is never constrained to a screen.
    extern "C-unwind" fn constrain_frame_rect_to_screen(
        _this: &AnyObject,
        _sel: Sel,
        frame: NSRect,
        _screen: *const NSScreen,
    ) -> NSRect {
        frame
    }

    /// Objective-C type encoding of `- (NSRect)constrainFrameRect:(NSRect)r toScreen:(NSScreen *)s`.
    const TYPES: &str = "{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@";

    /// Installs the no-op override on the window's own class. The class is shared by every
    /// tao window in the process, so the message window loses the constraint too; it keeps
    /// its own keep-on-screen guard, so losing AppKit's is harmless there. Swapping the
    /// instance's class instead breaks KVO's hidden subclass.
    pub fn allow_unconstrained_frame(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        static INSTALLED: OnceLock<()> = OnceLock::new();
        let ns_window = match window.ns_window() {
            Ok(ptr) => ptr,
            Err(err) => {
                log::warn!("allow_unconstrained_frame: no NSWindow: {err}");
                return Ok(());
            }
        };
        INSTALLED.get_or_init(|| {
            // SAFETY: `ns_window` is the live pet window; `-class` yields its real class
            // (KVO hides its dynamic subclass), and the replacement has the exact signature
            // AppKit declares for `constrainFrameRect:toScreen:`.
            unsafe {
                let obj = &*(ns_window as *const AnyObject);
                let class = obj.class() as *const _ as *mut objc2::runtime::AnyClass;
                let sel = sel!(constrainFrameRect:toScreen:);
                let imp: Imp = std::mem::transmute(
                    constrain_frame_rect_to_screen
                        as extern "C-unwind" fn(&AnyObject, Sel, NSRect, *const NSScreen) -> NSRect,
                );
                let types = CString::new(TYPES).expect("static encoding");
                // Adding fails only when the class itself already declares the method;
                // then it is replaced in place.
                if class_addMethod(class, sel, imp, types.as_ptr()) == false.into() {
                    let method = class_getInstanceMethod(class, sel);
                    if method.is_null() {
                        log::warn!(
                            "allow_unconstrained_frame: constrainFrameRect:toScreen: not found"
                        );
                    } else {
                        method_setImplementation(method, imp);
                    }
                }
            }
        });
        Ok(())
    }

    /// Converts a top-left-origin, y-down logical frame into Cocoa's bottom-left, y-up
    /// `NSRect`. `primary_height` is `NSScreen::screens()[0]`'s logical height — Cocoa's
    /// origin is that screen's bottom-left corner, whichever screen the window is on.
    pub fn cocoa_frame(_x: f64, _y: f64, _width: f64, _height: f64, _primary_height: f64) -> NSRect {
        NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn cocoa_frame_converts_a_window_above_the_primary_screen() {
            let frame = cocoa_frame(100.0, -1080.0, 400.0, 600.0, 1117.0);
            assert_eq!(frame, NSRect::new(NSPoint::new(100.0, 1597.0), NSSize::new(400.0, 600.0)));
        }

        #[test]
        fn cocoa_frame_converts_a_window_on_the_primary_screen() {
            let frame = cocoa_frame(100.0, 517.0, 400.0, 600.0, 1117.0);
            assert_eq!(frame, NSRect::new(NSPoint::new(100.0, 0.0), NSSize::new(400.0, 600.0)));
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::allow_unconstrained_frame;

/// No-op off macOS — AppKit's frame constraint has no equivalent elsewhere.
#[cfg(not(target_os = "macos"))]
pub fn allow_unconstrained_frame(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
