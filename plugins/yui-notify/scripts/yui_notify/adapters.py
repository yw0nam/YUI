from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, NamedTuple

EVENTS = {"Stop", "PermissionRequest", "Notification", "SessionStart", "SessionEnd", "UserPromptSubmit"}

# Claude Code wraps a relayed channel message in this markup when it fires UserPromptSubmit
CHANNEL_PROMPT_PREFIX = '<channel source="plugin:yui-notify:'

# Claude Code keeps a session transcript under .claude/projects; Codex keeps a rollout under .codex
CLAUDE_TRANSCRIPT = "/.claude/projects/"
CODEX_TRANSCRIPT = "/.codex/"


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


def _first_line(transcript_path: Any) -> dict | None:
    """the first JSON object of a transcript file"""
    try:
        with open(transcript_path) as f:
            line = json.loads(f.readline())
    except (OSError, TypeError, ValueError):
        return None
    return line if isinstance(line, dict) else None


def _codex_interactive(transcript_path: Any) -> bool:
    # the rollout's first line is session_meta; its source is "cli" or "vscode" for an interactive session
    line = _first_line(transcript_path)
    if line is None or line.get("type") != "session_meta":
        return False
    payload = line.get("payload")
    source = payload.get("source") if isinstance(payload, dict) else None
    return source in ("cli", "vscode")


def _transcript_agent(transcript_path: Any) -> str | None:
    """the agent whose session the transcript belongs to"""
    if not isinstance(transcript_path, str) or not transcript_path:
        return None
    line = _first_line(transcript_path)
    if line is not None:
        if line.get("type") == "session_meta":  # a Codex rollout
            return "codex"
        if isinstance(line.get("sessionId"), str):  # a Claude Code transcript
            return "claude-code"
    if CLAUDE_TRANSCRIPT in transcript_path:
        return "claude-code"
    if CODEX_TRANSCRIPT in transcript_path:
        return "codex"
    return None


def _agent(data: Mapping[str, Any]) -> str | None:
    """the agent that sent the payload, named by the payload's own fields"""
    # Codex sends turn_id on every turn-scoped event; Claude Code sends prompt_id
    if "turn_id" in data:
        return "codex"
    if "prompt_id" in data:
        return "claude-code"
    if "notification_type" in data:  # Codex has no Notification event
        return "claude-code"
    # the session-scoped events carry neither, so the transcript names the agent
    return _transcript_agent(data.get("transcript_path"))


def parse_event(data: Any, env: Mapping[str, str]) -> Event | None:
    if not isinstance(data, dict):
        return None
    phase = data.get("hook_event_name")
    if phase not in EVENTS or not isinstance(data.get("session_id"), str):
        return None
    agent = _agent(data)
    if agent is None:
        return None
    tasks = data.get("background_tasks")
    running = isinstance(tasks, list) and any(
        isinstance(t, dict) and t.get("status") == "running" for t in tasks
    )
    if (
        agent == "claude-code"
        and phase in ("Stop", "UserPromptSubmit", "SessionStart", "SessionEnd")
        and (running or env.get("CLAUDE_CODE_ENTRYPOINT", "").startswith("sdk"))
    ):
        return None
    if (
        agent == "codex"
        and phase in ("Stop", "UserPromptSubmit", "SessionEnd")
        and not _codex_interactive(data.get("transcript_path"))
    ):
        return None
    # /clear and /resume keep the same Thread alive in the continuing session
    if agent == "claude-code" and phase == "SessionEnd" and data.get("reason") in ("clear", "resume"):
        return None
    if phase == "Stop":
        text = data.get("last_assistant_message") or ""
    elif phase in ("PermissionRequest", "Notification"):
        text = _pending(data)
    elif phase == "UserPromptSubmit":
        text = data.get("prompt") or ""
        # the store records a channel answer itself; the echoed prompt adds no user entry
        if agent == "claude-code" and text.startswith(CHANNEL_PROMPT_PREFIX):
            text = ""
    elif phase == "SessionEnd":
        text = "Session ended"
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
