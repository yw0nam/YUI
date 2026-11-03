"""Hermes exec approvals as Asks."""

from collections.abc import Callable

from gateway.platforms.base import ExecApprovalPrompt
from tools.approval import resolve_gateway_approval


def exec_approval_ask(prompt: ExecApprovalPrompt) -> tuple[dict, Callable]:
    body = {
        "prompt": prompt.text,
        "choices": [
            {
                "id": choice,
                "label": label,
                **({"tone": style} if style in ("primary", "danger") else {}),
            }
            for label, choice, style in prompt.actions
        ],
        "text": False,
    }
    return body, lambda choice, _text: resolve_gateway_approval(
        prompt.session_key, choice, request_id=prompt.request_id
    )
