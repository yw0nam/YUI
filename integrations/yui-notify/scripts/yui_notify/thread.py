from __future__ import annotations

import json
import os
from collections.abc import Mapping
from typing import Any
from uuid import uuid4

from yui_notify.adapters import Event
from yui_notify.label import make_label, short_hostname

ENTRY_MAX = 16384
BODY_MAX_BYTES = 65536
LABEL_MAX = 120
TITLE_MAX = 200
PROMPT_MAX = 500


def terminal_state(phase: str) -> str:
    return "completed" if phase == "Stop" else "working"


def claude_thread_id(pid: str | int) -> str:
    return f"claude-code:{short_hostname()}:{pid}"


def thread_id(event: Event, env: Mapping[str, str]) -> str:
    if event.agent == "claude-code":
        return claude_thread_id(env.get("CLAUDE_PID") or os.getppid())
    return f"{event.agent}:{short_hostname()}:{event.session_id}"


def permission_ask(ask_id: str, tool: str, agent: str) -> dict:
    return {
        "ask_id": ask_id,
        "prompt": f"Allow {tool}?"[:PROMPT_MAX],
        "text": True,
        "placeholder": f"Or tell {agent} what to do instead",
        "choices": [
            {"id": "allow", "label": "Allow", "tone": "primary"},
            {"id": "deny", "label": "Deny", "tone": "danger"},
        ],
    }


def next_ask(ask_id: str) -> dict:
    return {"ask_id": ask_id, "prompt": "What next?", "text": True, "placeholder": "Next instruction"}


def _ask(event: Event) -> dict:
    permission = event.phase == "PermissionRequest"
    ask_id = f"{'perm' if permission else 'stop'}:{event.turn_id}:{uuid4().hex}"
    return permission_ask(ask_id, event.tool_name, "Codex") if permission else next_ask(ask_id)


def build_thread(event: Event, ctx: Mapping[str, Any], front: bool) -> dict:
    role = "user" if event.phase == "UserPromptSubmit" else "agent" if event.phase == "Stop" else "system"
    state = (
        terminal_state(event.phase)
        if event.phase == "UserPromptSubmit" or (event.phase == "Stop" and event.agent == "claude-code")
        else "input-required"
    )
    title = f"{ctx['project']} ({ctx['branch']})" if ctx["branch"] else ctx["project"]
    label = make_label(ctx)
    body = {
        "source": event.agent,
        "title": (title or event.agent)[:TITLE_MAX],
        "label": label[: LABEL_MAX - 1] + "…" if len(label) > LABEL_MAX else label,
        "state": state,
        "entries": [{"role": role, "text": event.text}] if event.text else [],
    }
    if event.phase == "UserPromptSubmit" or state == "completed":
        body["ask"] = None
    elif event.agent == "codex" and (event.phase == "Stop" or not front):
        body["ask"] = _ask(event)
    fit_entries(body)
    return body


def fit_entries(body: dict) -> None:
    if body["entries"]:
        text = body["entries"][0]["text"]
        shortened = len(text) > ENTRY_MAX
        head = text[: ENTRY_MAX - 1] if shortened else text
        body["entries"][0]["text"] = head + "…" if shortened else head
        while len(json.dumps(body, ensure_ascii=False).encode()) > BODY_MAX_BYTES:
            excess = len(json.dumps(body, ensure_ascii=False).encode()) - BODY_MAX_BYTES
            head = head[: -max(1, (excess + 3) // 4)]
            body["entries"][0]["text"] = head + "…"
