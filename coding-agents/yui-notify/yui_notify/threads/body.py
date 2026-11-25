from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from yui_notify.hook.event import Event
from yui_notify.host.claude_pid import claude_pid
from yui_notify.host.label import make_label, short_hostname

ENTRY_MAX = 16384
BODY_MAX_BYTES = 65536
TITLE_MAX = 200


def terminal_state(phase: str) -> str:
    return "completed" if phase in ("Stop", "SessionEnd") else "working"


def claude_thread_id(pid: str | int) -> str:
    return f"claude-code:{short_hostname()}:{pid}"


def thread_id(event: Event, env: Mapping[str, str]) -> str:
    if event.agent == "claude-code":
        return claude_thread_id(claude_pid(env, hook=True))
    return f"{event.agent}:{short_hostname()}:{event.session_id}"


def build_thread(event: Event, ctx: Mapping[str, Any]) -> dict:
    role = "user" if event.phase == "UserPromptSubmit" else "agent" if event.phase == "Stop" else "system"
    # a request or notification waits on the user; a stop or a session end finishes the turn
    state = (
        "input-required"
        if event.phase in ("PermissionRequest", "Notification")
        else terminal_state(event.phase)
    )
    title = f"{ctx['project']} ({ctx['branch']})" if ctx["branch"] else ctx["project"]
    body = {
        "source": event.agent,
        "title": (title or event.agent)[:TITLE_MAX],
        "label": make_label(ctx),
        "state": state,
        "entries": [{"role": role, "text": event.text}] if event.text else [],
    }
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
