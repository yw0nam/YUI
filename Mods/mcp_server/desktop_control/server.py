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
from mcp_server.desktop_control import ops

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
        "list_running_apps to see what is open, then open_app/close_app to launch "
        "or quit apps. open_app/close_app only work for allowlisted apps."
    ),
)


@mcp.tool
def screenshot() -> list[Image]:
    """Capture every display as a PNG image, one per monitor (long edge downscaled to 1280px by default)."""
    max_edge = _screenshot_max_edge()
    return [Image(data=png, format="png") for png in ops.capture_screens(max_edge)]


@mcp.tool
def list_running_apps() -> list[str]:
    """Return the names of currently visible (non-background) apps."""
    return ops.list_running_apps()


@mcp.tool
def open_app(name: str) -> dict[str, Any]:
    """Launch and focus an allowlisted app.

    Args:
        name: App name (e.g. "Safari"). Rejected if not in the allowlist.
    """
    allowed = _allowed_apps()
    if name not in allowed:
        return {"error": f"App not allowed: {name!r}. Allowlist: {sorted(allowed)}"}
    logger.info(f"open_app: {name}")
    ops.open_app(name)
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
    logger.info(f"close_app: {name}")
    ops.quit_app(name)
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
            "Screen Recording NOT granted — `screenshot` will capture wallpaper only. Grant "
            "the launching app in System Settings → Privacy & Security → Screen Recording."
        )
    if not ops.automation_granted():
        problems.append(
            "Automation to System Events NOT granted — list_running_apps/close_app will fail "
            "(-1743). Grant the launching app in System Settings → Privacy & Security → Automation."
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
