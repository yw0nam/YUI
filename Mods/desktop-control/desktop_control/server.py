"""Desktop Control MCP Server — local macOS screen awareness + app launch/quit.

A tool source the remote backend agent attaches to over an SSH reverse tunnel.
Runs host-native (Docker cannot reach the Mac WindowServer) because it needs the
host GUI. open/close reject any app outside the allowlist.
"""

import argparse
import os
from typing import Any

from fastmcp import FastMCP
from fastmcp.utilities.types import Image
from loguru import logger

# ponytail: loguru's default stderr handler is enough — no core/logger setup module
from desktop_control import activity, ops

ALLOWLIST_ENV = "DESKTOP_CONTROL_ALLOWED_APPS"
SCREENSHOT_MAX_EDGE_ENV = "DESKTOP_CONTROL_SCREENSHOT_MAX_EDGE"
DEFAULT_MAX_EDGE = 1280


def _allowed_apps() -> set[str]:
    """Comma-separated allowlist from env. Empty → empty set (= reject everything)."""
    raw = os.getenv(ALLOWLIST_ENV, "")
    return {name.strip() for name in raw.split(",") if name.strip()}


def _screenshot_max_edge() -> int | None:
    """Screenshot downscale long-edge px. Unset → 1280; '0'/empty → None (no resize)."""
    raw = os.getenv(SCREENSHOT_MAX_EDGE_ENV)
    if raw is None:
        return DEFAULT_MAX_EDGE
    raw = raw.strip()
    if raw in ("", "0"):
        return None
    try:
        return int(raw)
    except ValueError:
        logger.warning(f"{SCREENSHOT_MAX_EDGE_ENV}={raw!r} is not an int; using {DEFAULT_MAX_EDGE}")
        return DEFAULT_MAX_EDGE


mcp = FastMCP(
    name="Desktop Control",
    instructions=(
        "Local macOS desktop control. Use screenshot to see the current screen, "
        "get_frontmost_window to see what the user is looking at, list_running_apps "
        "to see what is open, get_activity_timeline to see which apps a past day was "
        "spent in, then open_app/close_app to launch or quit apps. "
        "open_app/close_app only work for allowlisted apps."
    ),
)


@mcp.tool
def screenshot() -> list[Image]:
    """Capture every display as a PNG image, one per monitor (long edge downscaled to 1280px by default)."""
    logger.info("🔍 screenshot")
    max_edge = _screenshot_max_edge()
    images = [Image(data=png, format="png") for png in ops.capture_screens(max_edge)]
    logger.info(f"⬅️ screenshot: {len(images)} display(s)")
    return images


@mcp.tool
def list_running_apps() -> list[str]:
    """Return the names of currently visible (non-background) apps."""
    logger.info("🔍 list_running_apps")
    apps = ops.list_running_apps()
    logger.info(f"⬅️ list_running_apps: {len(apps)} app(s)")
    return apps


@mcp.tool
def get_frontmost_window() -> dict[str, Any]:
    """Return the frontmost app and its front window title (`title` is null when there is none)."""
    logger.info("🔍 get_frontmost_window")
    app, title = ops.frontmost_window()
    logger.info(f"⬅️ get_frontmost_window: {app}")
    return {"app": app, "title": title}


@mcp.tool
def get_activity_timeline(date: str) -> dict[str, Any]:
    """Return one day of desktop activity as ordered segments, merged from the local witness log.

    Each segment is either `{start, end, type: "app", app, window_title, duration_min}` or an
    idle stretch `{start, end, type: "idle", duration_min}`. Consecutive records for one app
    form a single segment and a title change only updates the title. An app change recorded
    while the machine is idle is background churn, so it does not end the idle stretch. A day
    that starts mid-idle counts that idle from 00:00; the segment the last record opens ends at
    that record's timestamp, since nothing after it was observed, so it has a zero duration. A
    missing log directory or day file returns an empty timeline rather than an error, and the
    logs are kept 14 days, so any older date is empty whatever happened on it.

    Args:
        date: Day to read as "YYYY-MM-DD", in the log's local timezone.
    """
    logger.info(f"🔍 get_activity_timeline: {date}")
    result = activity.timeline(date)
    logger.info(f"⬅️ get_activity_timeline: {len(result.get('segments', []))} segment(s)")
    return result


@mcp.tool
def open_app(name: str) -> dict[str, Any]:
    """Launch and focus an allowlisted app.

    Args:
        name: App name (e.g. "Safari"). Rejected if not in the allowlist.
    """
    allowed = _allowed_apps()
    if name not in allowed:
        return {"error": f"App not allowed: {name!r}. Allowlist: {sorted(allowed)}"}
    logger.info(f"➡️ open_app: {name}")
    ops.open_app(name)
    logger.info(f"⬅️ open_app: {name}")
    return {"ok": True, "name": name}


@mcp.tool
def close_app(name: str) -> dict[str, Any]:
    """Gracefully quit an allowlisted app (not a force kill).

    Args:
        name: App name (e.g. "Notes"). Rejected if not in the allowlist.
    """
    allowed = _allowed_apps()
    if name not in allowed:
        return {"error": f"App not allowed: {name!r}. Allowlist: {sorted(allowed)}"}
    logger.info(f"➡️ close_app: {name}")
    ops.quit_app(name)
    logger.info(f"⬅️ close_app: {name}")
    return {"ok": True, "name": name}


def preflight() -> list[str]:
    """Check TCC grants at startup and log each gap explicitly, so an ungranted permission
    surfaces as a clear setup error instead of a silent no-op. Returns the problems found.

    Permissions attach to the responsible process (the terminal launching this), not a stable
    desktop-control identity — so the fix is to grant the launching app, and re-grant if you
    relaunch it differently.
    """
    problems: list[str] = []
    if not ops.screen_capture_granted():
        problems.append(
            "Screen Recording NOT granted — `screenshot` will capture wallpaper only and "
            "get_frontmost_window will report a null title. Grant the launching app in "
            "System Settings → Privacy & Security → Screen Recording."
        )
    if not ops.automation_granted():
        problems.append(
            "Automation to System Events NOT granted — list_running_apps will fail (-1743). "
            "Grant the launching app in System Settings → Privacy & Security → Automation. "
            "close_app is not covered by this check: it sends its Apple Event to the target "
            "app, so macOS asks for a separate Automation grant per target app on first quit."
        )
    for problem in problems:
        logger.warning(f"[setup] {problem}")
    return problems


def main() -> None:
    """Run the Desktop Control MCP Server."""
    parser = argparse.ArgumentParser(description="Desktop Control MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "http", "sse"],
        default="stdio",
        help="transport (default: stdio)",
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host")
    parser.add_argument("--port", type=int, default=9000, help="HTTP bind port")
    args = parser.parse_args()

    preflight()

    kwargs: dict[str, Any] = {"transport": args.transport}
    if args.transport != "stdio":
        kwargs["host"] = args.host
        kwargs["port"] = args.port

    mcp.run(**kwargs)


if __name__ == "__main__":
    main()
