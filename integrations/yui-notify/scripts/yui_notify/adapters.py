from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, NamedTuple

PENDING_MAX = 1000
PHASES = {"Stop": "done", "PermissionRequest": "needs_input", "Notification": "needs_input"}


class Event(NamedTuple):
    agent: str
    phase: str
    session_id: str
    cwd: str
    text: str


def _pending(data: Mapping[str, Any]) -> str:
    if data["hook_event_name"] == "Notification":
        return str(data.get("message") or "")[:PENDING_MAX]
    tool_input = data.get("tool_input")
    if isinstance(tool_input, dict) and isinstance(tool_input.get("command"), str):
        detail = tool_input["command"]
    else:
        detail = json.dumps(tool_input, ensure_ascii=False, separators=(",", ":"))
    return f"{data.get('tool_name')}: {detail}"[:PENDING_MAX]


def parse_event(data: Any, env: Mapping[str, str]) -> Event | None:
    if not isinstance(data, dict):
        return None
    # turn_id exists only in Codex input; Codex started from a Claude Code shell inherits CLAUDECODE=1
    if "turn_id" in data:
        agent = "codex"
    elif env.get("CLAUDECODE") == "1":
        agent = "claude-code"
    else:
        return None
    phase = PHASES.get(data.get("hook_event_name"))
    if phase is None or not isinstance(data.get("session_id"), str):
        return None
    tasks = data.get("background_tasks")
    running = isinstance(tasks, list) and any(
        isinstance(t, dict) and t.get("status") == "running" for t in tasks
    )
    if agent == "claude-code" and phase == "done" and running:
        return None
    text = (data.get("last_assistant_message") or "") if phase == "done" else _pending(data)
    return Event(agent, phase, data["session_id"], str(data.get("cwd") or ""), text)
