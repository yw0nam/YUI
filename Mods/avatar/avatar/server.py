"""Avatar MCP Server — the agent's own body: where it is, and where to move it.

A tool source the remote backend agent attaches to over an SSH reverse tunnel. Runs
host-native (it talks to the YUI client's loopback ingress, which lives on the Mac).

The client executes; it does not judge. These tools move the avatar and report what
happened. Expression stays on the `generate_express` stream, and screen capture
belongs to desktop-control — neither is exposed here.
"""

import argparse
from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from loguru import logger

# ponytail: loguru's default stderr handler is enough — no core/logger setup module
from avatar import ingress

SIDES = ("left", "right")
SPOTS = ("center", "top-left", "top-right", "bottom-left", "bottom-right")

# Why a gesture did not happen, in words the agent can act on.
REASONS = {
    "not_found": "not_found — no such window or screen spot to move to.",
    "blocked": "blocked — a window in front covers that spot, so the avatar stayed put.",
    "interrupted": "interrupted — the user is holding the avatar, or grabbed it mid-move.",
    "busy": "busy — another avatar gesture is still running.",
    "unsupported": "unsupported — the avatar cannot do that right now.",
}

mcp = FastMCP(
    name="Avatar",
    instructions=(
        "The avatar's own body on the user's desktop. Use get_body_state to see where it is "
        "and what it is doing, list_perch_targets to see which windows it can perch on, then "
        "sit_on_window / peek / move_to / stand_down to move it. Movement only — expression "
        "and speech travel on their own channel."
    ),
)


def _query(path: str, label: str) -> Any:
    try:
        return ingress.query(path)
    except ingress.IngressError as err:
        raise ToolError(f"{label}: {err}") from err


def _command(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        result = ingress.command(payload)
    except ingress.IngressError as err:
        raise ToolError(f"{payload['action']}: {err}") from err
    if not isinstance(result, dict):
        raise ToolError(f"{payload['action']}: the YUI app returned an unexpected result.")
    if result.get("ok") is True:
        return result
    reason = str(result.get("reason", "unknown"))
    raise ToolError(f"{payload['action']}: {REASONS.get(reason, reason)}")


@mcp.tool
def get_body_state() -> dict[str, Any]:
    """Where the avatar is and what it is doing right now.

    Returns its window position and monitor, its posture (standing / sitting / peeking /
    dragging, and what it is perched on), the loaded VRM, and whether a move is in progress.
    """
    logger.info("🔍 get_body_state")
    state = _query("/avatar/state", "get_body_state")
    logger.info(f"⬅️ get_body_state: {state}")
    return state


@mcp.tool
def list_perch_targets() -> dict[str, Any]:
    """Windows the avatar can currently sit on or peek around, plus the peek edges.

    These are the client's own tracked candidates, not a fresh screen scan — a window
    missing here cannot be perched on. Each window carries `app`, `title` and `rect`;
    `app` and `title` are null when the OS reports no name for that window.
    """
    logger.info("🔍 list_perch_targets")
    targets = _query("/avatar/perch-targets", "list_perch_targets")
    logger.info(f"⬅️ list_perch_targets: {len(targets.get('windows', []))} window(s)")
    return targets


@mcp.tool
def sit_on_window(app: str) -> dict[str, Any]:
    """Sit the avatar on the top edge of an app's window.

    Args:
        app: App name as reported by list_perch_targets (e.g. "Notes"). Matched case-insensitively.
    """
    logger.info(f"➡️ sit_on_window: {app}")
    result = _command({"action": "sit_on_window", "app": app})
    logger.info(f"⬅️ sit_on_window: {app}")
    return result


@mcp.tool
def peek(side: str) -> dict[str, Any]:
    """Have the avatar peek around one side edge of the frontmost window.

    Args:
        side: "left" or "right".
    """
    if side not in SIDES:
        raise ToolError(f"peek: side must be one of {list(SIDES)}, got {side!r}.")
    logger.info(f"➡️ peek: {side}")
    result = _command({"action": "peek", "side": side})
    logger.info(f"⬅️ peek: {side}")
    return result


@mcp.tool
def move_to(spot: str, monitor: int | None = None) -> dict[str, Any]:
    """Move the avatar to a named spot on screen, leaving any perch first.

    Args:
        spot: "center", "top-left", "top-right", "bottom-left" or "bottom-right".
        monitor: Monitor index from get_body_state. Omit to stay on the current monitor.
    """
    if spot not in SPOTS:
        raise ToolError(f"move_to: spot must be one of {list(SPOTS)}, got {spot!r}.")
    payload: dict[str, Any] = {"action": "move_to", "spot": spot}
    if monitor is not None:
        payload["monitor"] = monitor
    logger.info(f"➡️ move_to: {spot} monitor={monitor}")
    result = _command(payload)
    logger.info(f"⬅️ move_to: {spot}")
    return result


@mcp.tool
def stand_down() -> dict[str, Any]:
    """Release any perch or peek and return the avatar to its normal standing position."""
    logger.info("➡️ stand_down")
    result = _command({"action": "stand_down"})
    logger.info("⬅️ stand_down")
    return result


def main() -> None:
    """Run the Avatar MCP Server."""
    parser = argparse.ArgumentParser(description="Avatar MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "http", "sse"],
        default="stdio",
        help="transport (default: stdio)",
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host")
    parser.add_argument("--port", type=int, default=9002, help="HTTP bind port")
    args = parser.parse_args()

    logger.info(f"[setup] avatar ingress: {ingress.base_url()}")

    kwargs: dict[str, Any] = {"transport": args.transport}
    if args.transport != "stdio":
        kwargs["host"] = args.host
        kwargs["port"] = args.port

    mcp.run(**kwargs)


if __name__ == "__main__":
    main()
