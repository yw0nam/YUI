"""The token usage of the turn's last LLM call, as the client's session readout takes it.

The ``post_api_request`` hook fires after every LLM call on a hook worker thread. ``take`` hands
the latest call of a chat to the ``turn_end`` frame that closes its turn and forgets it.
"""

from __future__ import annotations

import threading

from ..turns import session

PLATFORM = "yui"

_lock = threading.Lock()
_latest: dict[str, dict[str, int]] = {}

# Frame field -> Hermes key; input_tokens leaves out cached tokens, prompt_tokens counts them.
_FIELDS = {"input_tokens": "prompt_tokens", "output_tokens": "output_tokens", "total_tokens": "total_tokens"}


def on_post_api_request(platform: object = None, usage: object = None, **_kwargs: object) -> None:
    """One LLM call finished. A subagent's or another platform's call is not ours."""
    if platform != PLATFORM:
        return
    # The hook names no chat, so the call belongs to the chat the gateway is running a turn for.
    chat_id = session.current_chat_id()
    if not chat_id:
        return
    mapped = _map(usage)
    with _lock:
        if mapped is None:
            _latest.pop(chat_id, None)
        else:
            _latest[chat_id] = mapped


def take(chat_id: str) -> dict[str, int] | None:
    """The usage of the chat's latest call, once."""
    with _lock:
        return _latest.pop(chat_id, None)


def _map(usage: object) -> dict[str, int] | None:
    """The frame's three figures, or None when the call reported no usage or lacks one."""
    if not isinstance(usage, dict):
        return None
    mapped = {field: usage.get(key) for field, key in _FIELDS.items()}
    if not all(isinstance(value, int) and not isinstance(value, bool) for value in mapped.values()):
        return None
    return mapped
