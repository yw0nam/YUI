from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, NamedTuple

from yui_notify.inbox.post import PREFIX
from yui_notify.threads.question import usable_questions

# Claude Code marks a queued command only by the prompt's leading tag
QUEUED = ("<task-notification>", "<agent-message ")
EVENTS = {"Stop", "PermissionRequest", "Notification", "SessionStart", "SessionEnd", "UserPromptSubmit"}


class Event(NamedTuple):
    agent: str
    phase: str
    session_id: str
    cwd: str
    text: str
    turn_id: str
    tool_name: str
    tool_input: dict


def _lines(question: dict) -> str:
    options = (
        f"- {o['label']}: {o['description']}" if o.get("description") else f"- {o['label']}"
        for o in question["options"]
    )
    return "\n".join([question["question"], *options])


def _pending(data: Mapping[str, Any]) -> str:
    if data["hook_event_name"] == "Notification":
        return str(data.get("message") or "")
    tool_input = data.get("tool_input")
    questions = usable_questions(tool_input) if data.get("tool_name") == "AskUserQuestion" else None
    if questions:
        return "\n\n".join(map(_lines, questions))
    if isinstance(tool_input, dict) and isinstance(tool_input.get("command"), str):
        detail = tool_input["command"]
    else:
        detail = json.dumps(tool_input, ensure_ascii=False, separators=(",", ":"))
    # a fence makes the Threads window show the command as code
    return f"{data.get('tool_name')}:\n```\n{detail}\n```"


def _rollout_source(transcript_path: Any) -> Any:
    # a Codex rollout's first line is session_meta; its source is "cli" or "vscode" for an interactive session
    try:
        with open(transcript_path) as f:
            line = json.loads(f.readline())
        return line["payload"]["source"] if line["type"] == "session_meta" else None
    except (OSError, TypeError, ValueError, KeyError):
        return None


def parse_event(data: Any, env: Mapping[str, str]) -> Event | None:
    if not isinstance(data, dict):
        return None
    phase = data.get("hook_event_name")
    if phase not in EVENTS or not isinstance(data.get("session_id"), str):
        return None
    transcript = data.get("transcript_path")
    source = _rollout_source(transcript)
    # the payload names Codex by turn_id, a null transcript_path, or a rollout, and Claude Code by prompt_id;
    # a Codex in a Claude Code shell inherits CLAUDECODE=1
    if "turn_id" in data or transcript is None or source is not None:
        agent = "codex"
    elif "prompt_id" in data or env.get("CLAUDECODE") == "1":
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
        and phase in ("Stop", "UserPromptSubmit", "SessionStart", "SessionEnd")
        and (running or env.get("CLAUDE_CODE_ENTRYPOINT", "").startswith("sdk"))
    ):
        return None
    if (
        agent == "codex"
        and phase in ("Stop", "UserPromptSubmit", "SessionEnd")
        and source not in ("cli", "vscode")
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
        # an inbox answer is already in the store, and a queued report or notification is no typed prompt
        if agent == "claude-code" and text.startswith((PREFIX, *QUEUED)):
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
        data["tool_input"] if isinstance(data.get("tool_input"), dict) else {},
    )
