from __future__ import annotations

import json
import os
import socket
from collections.abc import Mapping
from typing import Any
from uuid import uuid4

from yui_notify.adapters import Event
from yui_notify.label import make_label


def thread_id(event: Event, env: Mapping[str, str]) -> str:
    session = (
        (env.get("CLAUDE_PID") or str(os.getppid())) if event.agent == "claude-code" else event.session_id
    )
    return f"{event.agent}:{socket.gethostname().split('.')[0]}:{session}"


def _ask(event: Event) -> dict:
    permission = event.phase == "PermissionRequest"
    ask = {
        "ask_id": f"{'perm' if permission else 'stop'}:{event.turn_id}:{uuid4().hex}",
        "prompt": f"Allow {event.tool_name}?"[:500] if permission else "What next?",
        "text": True,
        "placeholder": "Or tell Codex what to do instead" if permission else "Next instruction",
    }
    if permission:
        ask["choices"] = [
            {"id": "allow", "label": "Allow", "tone": "primary"},
            {"id": "deny", "label": "Deny", "tone": "danger"},
        ]
    return ask


def build_thread(event: Event, ctx: Mapping[str, Any], front: bool) -> dict:
    role = "user" if event.phase == "UserPromptSubmit" else "agent" if event.phase == "Stop" else "system"
    state = (
        "working"
        if event.phase == "UserPromptSubmit"
        else "completed"
        if event.phase == "Stop" and event.agent == "claude-code"
        else "input-required"
    )
    title = f"{ctx['project']} ({ctx['branch']})" if ctx["branch"] else ctx["project"]
    label = make_label(ctx)
    body = {
        "source": event.agent,
        "title": (title or event.agent)[:200],
        "label": label[:119] + "…" if len(label) > 120 else label,
        "state": state,
        "entries": [{"role": role, "text": event.text}] if event.text else [],
    }
    if event.phase == "UserPromptSubmit" or state == "completed":
        body["ask"] = None
    elif event.agent == "codex" and (event.phase == "Stop" or not front):
        body["ask"] = _ask(event)
    if body["entries"]:
        text = event.text
        shortened = len(text) > 16384
        head = text[:16383] if shortened else text
        body["entries"][0]["text"] = head + "…" if shortened else head
        while len(json.dumps(body, ensure_ascii=False).encode()) > 65536:
            excess = len(json.dumps(body, ensure_ascii=False).encode()) - 65536
            head = head[: -max(1, (excess + 3) // 4)]
            body["entries"][0]["text"] = head + "…"
    return body


def hook_output(phase: str, answer: Any) -> dict | None:
    if not isinstance(answer, dict) or answer.get("release"):
        return None
    text = answer.get("text")
    if phase == "Stop":
        return {"decision": "block", "reason": text} if isinstance(text, str) and text else None
    choice = answer.get("choice")
    if choice == "allow":
        decision = {"behavior": "allow"}
    elif choice == "deny" or (isinstance(text, str) and text):
        decision = {"behavior": "deny"}
        if isinstance(text, str) and text:
            decision["message"] = text
    else:
        return None
    return {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": decision}}
