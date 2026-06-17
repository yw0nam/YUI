"""macOS desktop OS actions — fixed-binary shell-outs. The mocking boundary for tests."""

import subprocess
import tempfile
from pathlib import Path

_LIST_APPS_SCRIPT = (
    'tell application "System Events" to get name of '
    "(every process whose background only is false)"
)


def list_running_apps() -> list[str]:
    """Names of visible (non-background) apps. osascript output is a ', '-joined string."""
    out = _run(["osascript", "-e", _LIST_APPS_SCRIPT])
    return [name.strip() for name in out.split(",") if name.strip()]


def open_app(name: str) -> None:
    """Launch and focus an app (`open -a`)."""
    _run(["open", "-a", name])


def quit_app(name: str) -> None:
    """Send a graceful quit signal to an app (not a kill)."""
    _run(["osascript", "-e", f'quit app "{name}"'])


def capture_screen(max_edge: int | None = None) -> bytes:
    """Capture the current screen as PNG bytes (`screencapture -x`, no shutter sound).

    When max_edge is given, downscale the long edge to that value with `sips -Z`
    to keep full-resolution images from bloating the agent's context (tokens/latency).
    """
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        _run(["screencapture", "-x", "-t", "png", str(path)])
        if max_edge:
            _run(["sips", "-Z", str(max_edge), str(path)])
        return path.read_bytes()
    finally:
        path.unlink(missing_ok=True)


def _run(cmd: list[str]) -> str:
    """List-argument subprocess (never shell=True → no injection). Returns stdout."""
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout
