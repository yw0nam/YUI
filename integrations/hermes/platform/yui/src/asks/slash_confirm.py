"""Hermes slash confirmations as Asks."""

from collections.abc import Callable


def _prompt(title: str, message: str) -> str:
    head, _, last = message.rpartition("\n\n")
    # Hermes ends every locale's prompt with an italic line naming the /approve reply, which the card's buttons replace.
    if head and last.startswith("_") and "approve`" in last:
        message = head
    return message if title in message else f"{title}\n\n{message}"


def slash_confirm_ask(title: str, message: str, answer: Callable) -> tuple[dict, Callable]:
    return {
        "prompt": _prompt(title, message),
        "choices": [
            {"id": "once", "label": "Approve once", "tone": "primary"},
            {"id": "always", "label": "Always approve"},
            {"id": "cancel", "label": "Cancel", "tone": "danger"},
        ],
        "text": False,
    }, lambda choice, _text: answer(choice)
