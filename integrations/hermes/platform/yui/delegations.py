"""The work handed to background workers, per chat, as the client mirrors it.

``subagent_start`` and ``subagent_stop`` both fire for a background delegation, so the list is
maintained from those hooks. Both run under the parent turn's session context, which is how a
delegation finds its chat.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from . import session

logger = logging.getLogger(__name__)

MAX_ITEMS = 50
TITLE_MAX_LEN = 120

_lock = threading.Lock()
_items: dict[str, list[dict]] = {}
_notifier: Callable[[str], None] | None = None


def set_notifier(callback: Callable[[str], None] | None) -> None:
    """Who to tell when a chat's list changes; the adapter sends the frame."""
    global _notifier
    _notifier = callback


def forget(chat_id: str) -> None:
    with _lock:
        _items.pop(chat_id, None)


def items(chat_id: str) -> list[dict]:
    """The chat's list in the shape the client reads."""
    with _lock:
        held = list(_items.get(chat_id, []))
    return [{k: v for k, v in item.items() if k != "key" and v is not None} for item in held]


def _title(goal: Any) -> str:
    first_line = str(goal or "").strip().splitlines()
    return (first_line[0] if first_line else "")[:TITLE_MAX_LEN]


def _evict(held: list[dict]) -> None:
    """Past the cap the oldest finished delegation goes, and with none finished the oldest of all."""
    while len(held) > MAX_ITEMS:
        finished = [index for index, item in enumerate(held) if item["state"] == "done"]
        held.pop(finished[0] if finished else 0)


def _announce(chat_id: str) -> None:
    notifier = _notifier
    if notifier is None:
        return
    try:
        notifier(chat_id)
    except Exception:
        logger.debug("yui: delegation notifier failed", exc_info=True)


def on_subagent_start(
    child_session_id: Any = None,
    child_subagent_id: Any = None,
    child_goal: Any = None,
    **_kwargs: Any,
) -> None:
    """Record a delegation the agent just handed over."""
    key = str(child_session_id or child_subagent_id or "")
    chat_id = session.current_chat_id()
    if not chat_id or not key:
        return
    item = {
        "key": key,
        "id": str(child_subagent_id or child_session_id),
        "title": _title(child_goal),
        "started_at": int(time.time() * 1000),
        "state": "running",
        "ended_at": None,
    }
    with _lock:
        held = _items.setdefault(chat_id, [])
        held.append(item)
        _evict(held)
    _announce(chat_id)


def on_subagent_stop(child_session_id: Any = None, child_subagent_id: Any = None, **_kwargs: Any) -> None:
    """Close a delegation out; a failed one is finished too, the agent says so in speech."""
    key = str(child_session_id or child_subagent_id or "")
    chat_id = session.current_chat_id()
    if not chat_id or not key:
        return
    with _lock:
        held = _items.get(chat_id, [])
        found = next((item for item in reversed(held) if item["key"] == key), None)
        if found is None:
            return
        found["state"] = "done"
        found["ended_at"] = int(time.time() * 1000)
    _announce(chat_id)
