from __future__ import annotations

from typing import Any


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
