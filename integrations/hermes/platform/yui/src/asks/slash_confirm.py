"""Hermes slash confirmations as Asks."""

from collections.abc import Callable


def slash_confirm_ask(title: str, message: str, answer: Callable) -> tuple[dict, Callable]:
    return {
        "prompt": f"{title}\n\n{message}",
        "choices": [
            {"id": "once", "label": "Approve once", "tone": "primary"},
            {"id": "always", "label": "Always approve"},
            {"id": "cancel", "label": "Cancel", "tone": "danger"},
        ],
        "text": False,
    }, lambda choice, _text: answer(choice)
