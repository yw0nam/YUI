from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, NamedTuple

EVENTS = {"Stop", "PermissionRequest", "Notification", "SessionStart", "UserPromptSubmit"}


class Event(NamedTuple):
    agent: str
    phase: str
    session_id: str
    cwd: str
    text: str
    turn_id: str
    tool_name: str


def _pending(data: Mapping[str, Any]) -> str:
    if data["hook_event_name"] == "Notification":
        return str(data.get("message") or "")
    tool_input = data.get("tool_input")
    if isinstance(tool_input, dict) and isinstance(tool_input.get("command"), str):
        detail = tool_input["command"]
    else:
        detail = json.dumps(tool_input, ensure_ascii=False, separators=(",", ":"))
    return f"{data.get('tool_name')}: {detail}"


def _codex_interactive(transcript_path: Any) -> bool:
    # the rollout's first line is session_meta; its source is "cli" or "vscode" for an interactive session
    try:
        with open(transcript_path) as f:
            return json.loads(f.readline())["payload"]["source"] in ("cli", "vscode")
    except (OSError, TypeError, ValueError, KeyError):
        return False


def parse_event(data: Any, env: Mapping[str, str]) -> Event | None:
    if not isinstance(data, dict):
        return None
    phase = data.get("hook_event_name")
    if phase not in EVENTS or not isinstance(data.get("session_id"), str):
        return None
    # turn_id marks Codex input except at SessionStart; a Codex in a Claude Code shell inherits CLAUDECODE=1
    if "turn_id" in data:
        agent = "codex"
    elif env.get("CLAUDECODE") == "1":
        agent = "claude-code"
    elif phase == "SessionStart":
        agent = "codex"
    else:
        return None
    tasks = data.get("background_tasks")
    running = isinstance(tasks, list) and any(
        isinstance(t, dict) and t.get("status") == "running" for t in tasks
    )
    if (
        agent == "claude-code"
        and phase in ("Stop", "SessionStart")
        and (running or env.get("CLAUDE_CODE_ENTRYPOINT", "").startswith("sdk"))
    ):
        return None
    if agent == "codex" and phase == "Stop" and not _codex_interactive(data.get("transcript_path")):
        return None
    if phase == "Stop":
        text = data.get("last_assistant_message") or ""
    elif phase in ("PermissionRequest", "Notification"):
        text = _pending(data)
    elif phase == "UserPromptSubmit":
        text = data.get("prompt") or ""
    else:
        text = ""
    return Event(
        agent,
        phase,
        data["session_id"],
        str(data.get("cwd") or ""),
        text,
        str(data.get("turn_id") or ""),
        str(data.get("tool_name") or ""),
    )
