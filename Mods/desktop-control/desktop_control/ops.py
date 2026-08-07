"""macOS desktop OS actions — fixed-binary shell-outs. The mocking boundary for tests."""

import subprocess
import tempfile
from pathlib import Path

_LIST_APPS_SCRIPT = (
    'tell application "System Events" to get name of (every process whose background only is false)'
)

# Safety cap when probing display indices (screencapture -D is 1-based).
_MAX_DISPLAYS = 8


def list_running_apps() -> list[str]:
    """Names of visible (non-background) apps. osascript output is a ', '-joined string."""
    out = _run(["osascript", "-e", _LIST_APPS_SCRIPT])
    return [name.strip() for name in out.split(",") if name.strip()]


def frontmost_window() -> tuple[str | None, str | None]:
    """Name of the frontmost app and the title of its front window.

    `title` is None when the app has no on-screen document window, and also when Screen
    Recording is ungranted — without it `kCGWindowName` is absent from every entry.
    """
    from AppKit import NSWorkspace  # macOS-only; imported lazily
    from Quartz import (
        CGWindowListCopyWindowInfo,
        kCGNullWindowID,
        kCGWindowLayer,
        kCGWindowListOptionOnScreenOnly,
        kCGWindowName,
        kCGWindowOwnerPID,
    )

    app = NSWorkspace.sharedWorkspace().frontmostApplication()
    if app is None:
        return None, None
    pid = app.processIdentifier()
    windows = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) or []
    # The on-screen list is front-to-back, so the first layer-0 match is the front window.
    for window in windows:
        if window.get(kCGWindowOwnerPID) == pid and window.get(kCGWindowLayer) == 0:
            return app.localizedName(), window.get(kCGWindowName) or None
    return app.localizedName(), None


def screen_capture_granted() -> bool:
    """True if Screen Recording (TCC) is granted for the responsible process. Non-prompting.

    `AXIsProcessTrusted` is the wrong check here — it reads Accessibility, a different bucket.
    """
    from Quartz import CGPreflightScreenCaptureAccess  # macOS-only; imported lazily

    return bool(CGPreflightScreenCaptureAccess())


def automation_granted() -> bool:
    """True if Apple Events to System Events is granted. No non-prompting preflight API exists
    for this bucket, so probe by running the real query: -1743 (errAEEventNotPermitted) means
    not granted; other failures re-raise.
    """
    try:
        _run(["osascript", "-e", _LIST_APPS_SCRIPT])
        return True
    except subprocess.CalledProcessError as exc:
        if "-1743" in (exc.stderr or ""):
            return False
        raise


def open_app(name: str) -> None:
    """Launch and focus an app (`open -a`)."""
    _run(["open", "-a", name])


def quit_app(name: str) -> None:
    """Send a graceful quit signal to an app (not a kill)."""
    _run(["osascript", "-e", f'quit app "{name}"'])


def capture_screens(max_edge: int | None = None) -> list[bytes]:
    """Capture every display as PNG bytes — one entry per display.

    Probes display indices upward (`screencapture -D`) until one is invalid, so a
    window on any monitor is captured, not just the main display.
    """
    shots: list[bytes] = []
    for index in range(1, _MAX_DISPLAYS + 1):
        png = _capture_display(index, max_edge)
        if png is None:
            break
        shots.append(png)
    return shots


def _capture_display(index: int, max_edge: int | None) -> bytes | None:
    """Capture one display (`screencapture -x -D`, no shutter sound). None if `index`
    is out of range. When max_edge is given, downscale the long edge with `sips -Z`
    to keep images from bloating the agent's context (tokens/latency).
    """
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        result = subprocess.run(
            ["screencapture", "-x", "-D", str(index), "-t", "png", str(path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return None
        if max_edge:
            _run(["sips", "-Z", str(max_edge), str(path)])
        return path.read_bytes()
    finally:
        path.unlink(missing_ok=True)


def _run(cmd: list[str]) -> str:
    """List-argument subprocess (never shell=True → no injection). Returns stdout."""
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout
