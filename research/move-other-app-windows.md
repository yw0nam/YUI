# Research: can a Tauri app move, shake or nudge another app's window on macOS and Windows?

Issue: yw0nam/YUI#2095 (`wayfinder:research`)
Scope: facts only, no recommendation for YUI.

Verification legend:
- **[V]** verified: the page was opened or the local SDK header was read; the URL or path is cited.
- **[U]** unverified: stated from memory, a search snippet, or a secondary source, or the page could not be opened.

---

## 1. macOS

### 1.1 Read other apps' windows

- **CGWindowList** [V]. `CGWindowListCopyWindowInfo(option, relativeToWindow)` returns a dictionary per window (owner, bounds, window ID, and so on).
  - Source: Apple docs https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:) (opened). Header `CGWindow.h`, `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/CoreGraphics.framework/Versions/A/Headers/CGWindow.h`, lines 141-145.
  - `kCGWindowListOptionAll = 0` returns all windows, including off-screen ones. `kCGWindowListOptionOnScreenOnly = (1 << 0)` returns "all on-screen windows in this user session, ordered from front to back" (CGWindow.h:141-145).
  - Whether `OnScreenOnly` excludes windows on other Spaces, and what full-screen windows return: [U]. The header and docs do not say.
  - Window names (`kCGWindowName`) require Screen Recording permission since macOS 10.15: [U] (from memory; the SDK header comment at CGWindow.h:118 does not state it).
- **AXUIElement** (Accessibility API) [V for existence and signatures, U for behavior on other apps].
  - `AXUIElementCopyElementAtPosition(application, x, y, element)` exists (SDK `AXUIElement.h`, line 334).
  - Reading an element's position: `kAXPositionAttribute` is "the global screen coordinates of the top-left corner of this accessibility object"; 0,0 is the top-left of the menu-bar screen (Apple docs https://developer.apple.com/documentation/applicationservices/kaxpositionattribute, opened). Its value is an `AXValueRef` of type `kAXValueCGPointType` (SDK `AXAttributeConstants.h`, lines 609-615).
  - Setting it: `AXUIElementSetAttributeValue(element, kAXPositionAttribute, value)` takes an `AXValueRef` (CGPoint). Whether AXPosition is settable on a given window: [U]. The `AXUIElementSetAttributeValue` docs page did not render (title only). Use `AXUIElementIsAttributeSettable` to check (from memory, [U]).
  - Error codes (`kAXErrorAPIDisabled`, `kAXErrorCannotComplete`, and others): [U] (from memory; the docs page did not render).

### 1.2 Permission

- The process must be a trusted accessibility client. `AXIsProcessTrusted()` and `AXIsProcessTrustedWithOptions(options)` report this [V: SDK `AXUIElement.h`, lines 55-64].
- `kAXTrustedCheckOptionPrompt` set to true asks the system to inform the user if the process is untrusted. "Prompting occurs asynchronously and does not affect the return value" [V: `AXUIElement.h` lines 59-60].
- User-facing location: System Settings > Privacy & Security > Accessibility. Apple's help page https://support.apple.com/guide/mac-help/mh43185/mac (opened) says "When a third-party app tries to access and control your Mac through accessibility features, you receive an alert" and the user must grant access there.
- Without this grant, AX calls on another app's element fail. The failure code for an untrusted process is `kAXErrorAPIDisabled` [U, from memory].
- A rebuilt ad-hoc-signed build needs the permission granted again. Source: Rectangle README (https://raw.githubusercontent.com/rxhanson/Rectangle/main/README.md, opened), developer note.

### 1.3 Full-screen windows and other Spaces

- Apple provides no public API to move a window to another Space. Source: Rectangle README, "Apple never released a public API for doing this" (opened). [V]
- Whether AX can position or read a full-screen window, or a window on another Space: [U]. Not found in any opened source.

### 1.4 Crates (crates.io / docs.rs)

- `macos-accessibility-client` 0.0.2, "Wrapper around macOS' accessibility client APIs" [V: https://docs.rs/macos-accessibility-client/latest/macos_accessibility_client/ opened]. The page lists two modules (`accessibility`, `raw`) and no function names. Whether it exposes a trust check or a position setter: [U].
- `accessibility` 0.2.0, "Bindings for macOS Accessibility services" [V: https://docs.rs/accessibility/latest/accessibility/ opened]. Main items are `ElementFinder`, `TreeWalker`, `TreeVisitor`, modules `action`, `attribute`, `ui_element`. The page states 0% of the crate is documented. Whether it can set AXPosition: [U].
- `x-win` 5.8.0, "retrieve precise information about active and open windows on Windows, MacOS, and Linux" [V: https://docs.rs/x-win/latest/x_win/ opened]. Listed functions are `get_active_window`, `get_open_windows`, `get_browser_url`, `get_window_icon`, and GNOME extension helpers. It is a read-only window-info crate as far as the listed API goes; no move/resize function is listed [V for the listing, U for the absence of move methods inside the `Api` trait, which the page did not expand].
- Rust FFI bindings: `objc2` 0.6 and `objc2-app-kit` 0.3 are already in this repo (see section 3). Whether they expose the AX API: [U, not checked].

---

## 2. Windows

### 2.1 Move or resize another window

- `SetWindowPos(hWnd, hWndInsertAfter, X, Y, cx, cy, uFlags)` "Changes the size, position, and Z order of a child, pop-up, or top-level window" [V: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos, opened]. Returns nonzero on success; on failure, call `GetLastError`.
- Remarks [V, same page]:
  - "As part of the Vista re-architecture, all services were moved off the interactive desktop into Session 0. hwnd and window manager operations are only effective inside a session and cross-session attempts to manipulate the hwnd will fail."
  - "To use SetWindowPos to bring a window to the top, the process that owns the window must have SetForegroundWindow permission."
- Process-level restriction for another app's window: UIPI (section 2.2). Whether `SetWindowPos` specifically is blocked by UIPI: [U]. The Microsoft SetPropW page says UIPI applies to it, and a Microsoft Q&A thread reports `SetWindowPos` failing with access denied for `osk.exe` (forum answer, not opened; search snippet only).

### 2.2 UIPI (User Interface Privilege Isolation)

- The Microsoft UIPI page (`learn.microsoft.com/.../winmsg/uipi`) returned 404 [V: attempted and failed]. The UIPI description below comes from a search snippet and is [U].
- Verified statement from SetPropW docs https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setpropw (opened) [V]: "SetProp is subject to the restrictions of User Interface Privilege Isolation (UIPI). A process can only call this function on a window belonging to a process of lesser or equal integrity level. When UIPI blocks property changes, GetLastError will return 5."
- From the search snippet [U]: UIPI stops lower-integrity processes from sending messages to, or installing hooks in, higher-integrity processes; same-integrity messages are unaffected.
- Practical effect for an unelevated process: a window owned by an elevated (high-integrity) process is not reachable. AltSnap wiki, section 2.4, states it [V].

### 2.3 Permission or prompt

- Standard (unelevated) process: no prompt is shown for `SetWindowPos` on a non-elevated window [U, from memory; no source opened]. A prompt only appears through UAC when the app itself requests elevation.
- Elevated windows: the AltSnap wiki says "Normal programs can't interact with programs that are started with administrator privileges" and recommends elevating AltSnap via the tray "Elevate" option, where "the UAC will prompt you" [V: https://github.com/RamonUnch/AltSnap/wiki, opened].
- UIAccess: a process with the uiAccess flag can bypass UIPI for elevated targets. Microsoft's UAC policy docs say UIAccess apps must be "installed in secure locations" [U, from search snippet to learn.microsoft.com UAC policy page; not opened]. Power Automate's UIPI docs say a process "can only send commands to applications of the same or lower elevation" [U, search snippet].
- AltSnap's alternative path (install under Program Files, self-sign, set uiAccess) is described in its release notes [U, via search snippet of a softpedia changelog; the GitHub release page was not opened].

### 2.4 Full-screen windows and other virtual desktops

- Virtual desktops: not verified. The EnumWindows page doc says it "enumerates all top-level windows on the screen" and "For Windows 8 and later, EnumWindows enumerates only top-level windows of desktop apps." [V]. Whether it includes windows on other virtual desktops: [U]. The `IVirtualDesktopManager` COM API was not researched.
- Full-screen windows: not verified. Only the session-0 restriction (section 2.1) is verified.

### 2.5 Enumerating windows

- `EnumWindows(lpEnumFunc, lParam)` enumerates top-level windows in Z order; it does not enumerate child windows, except some system top-level windows with `WS_CHILD` [V: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows, opened].

### 2.6 Crate

- The `windows` crate 0.61 is in this repo's `src-tauri/Cargo.toml` (line 71) with features including `Win32_UI_WindowsAndMessaging`, which exposes `SetWindowPos` and `EnumWindows` [V: Cargo.toml]. The docs.rs page for `SetWindowPos` returned 404 [V: attempted]; the crate's signature for `SetWindowPos` was not checked [U].

---

## 3. This repository

Grep of `src-tauri/` (excluding nothing; no matches for `accessib` anywhere in `src-tauri`):

| Item | Location | Status |
|---|---|---|
| AXUIElement / AXIsProcessTrusted / kAX* | none | [V: grep, no hits] |
| Accessibility usage description or entitlement | none in `Info.plist`, `Entitlements.plist`, `tauri.conf.json` | [V: grep, no hits] |
| CGWindowList (reads other apps' windows) | `src-tauri/src/os_event_watcher/macos.rs:16-20` (option constants), `:34-35` (FFI decl of `CGWindowListCopyWindowInfo`), `:276-277` (`enumerate`) | [V: read via grep] |
| EnumWindows (reads top-level windows) | `src-tauri/src/os_event_watcher/windows.rs:32`, `:299`, `:348-353` | [V: read via grep] |
| SetWindowPos on a window | `src-tauri/src/threads_window.rs:60`, `:69` | [V: grep only; which HWND it targets was not read] |
| Windows crate features | `src-tauri/Cargo.toml:71` | [V] |
| objc2 / objc2-app-kit | `src-tauri/Cargo.toml:78-80` | [V] |

The repo reads other apps' windows (CGWindowList on macOS, EnumWindows on Windows) but does not call any AX API and does not request Accessibility permission.

---

## 4. How established apps ask for the permission

| App | Platform | Finding | Status |
|---|---|---|---|
| Rectangle | macOS | Needs Accessibility permission; README troubleshooting: "Try resetting the macOS accessibility permissions for Rectangle"; the README does not say why it is needed. | [V] https://raw.githubusercontent.com/rxhanson/Rectangle/main/README.md (opened) |
| Rectangle | macOS | Cannot move windows to other Spaces: "Apple never released a public API for doing this." | [V] same README |
| Magnet | macOS | Repo URL guess returned 404; no source for its permission flow was opened. Only a generic Apple help page was found. | [U] |
| AltSnap | Windows | Alt+drag moves and resizes windows. It cannot move elevated windows; it suggests running elevated via UAC. | [V] https://github.com/RamonUnch/AltSnap/wiki (opened) |
| AltSnap | Windows | Alternative to elevation is Program Files + uiAccess + self-signing. | [U] (release-notes snippet) |
| Shimeji-ee | cross-platform | No verified source on window moving or permission. Forks found by search (not opened): `github.com/LavenderSnek/ShimejiEE-cross-platform`, `github.com/dalekcraft2/shimeji-desktop`. Original repo URL returned 404. | [U] |
| Desktop Goose | Windows, macOS | A forum comment says it can move other windows on Windows and macOS. A third-party site says macOS Accessibility may be needed. Neither is official. | [U] (itch.io comment, androidexperto.com) |

Apple's generic prompt for a third-party app that controls the Mac via accessibility features is [V] (https://support.apple.com/guide/mac-help/mh43185/mac, opened).

---

## 5. Open items (not verified)

1. Whether AXPosition can be set on another app's window on macOS, and with which error code it fails when untrusted.
2. Whether full-screen windows and windows on other Spaces are reachable via AX, and whether CGWindowList `OnScreenOnly` excludes other-Space windows.
3. Whether `SetWindowPos` on another process's window is blocked by UIPI, with the exact failure code (the Microsoft UIPI page was not reachable).
4. Whether Windows virtual-desktop windows are enumerated by `EnumWindows`, and whether `SetWindowPos` works on them.
5. Whether Screen Recording permission is needed to read window names on macOS.
6. Exact behavior of `accessibility` and `macos-accessibility-client` crates for setting position; their docs.rs pages do not list it.
7. Magnet and Shimeji-ee permission and window-moving behavior; Desktop Goose official source.
