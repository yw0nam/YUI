"""The backend's reasoning as it is streamed.

Live tokens arrive on the ``on_stream_delta`` hook with ``kind="reasoning"``, on a hook worker
thread, and only while the gateway's ``plugins.stream_reasoning_deltas`` is on. ``live_text``
hands the text written so far for the turn in flight to the ``render`` frame that closes it.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from ..turns import session

logger = logging.getLogger(__name__)

PLATFORM = "yui"

_lock = threading.Lock()
_live: dict[str, list[str]] = {}
_sink: Callable[[str, str], None] | None = None


def set_sink(callback: Callable[[str, str], None] | None) -> None:
    """Who to hand a delta to; the adapter coalesces them onto its loop."""
    global _sink
    _sink = callback


def on_stream_delta(
    delta: object = None, kind: object = None, surface: object = None, **_kwargs: object
) -> None:
    """One streamed token. Answer text and other platforms' turns are not ours."""
    if kind != "reasoning" or surface != PLATFORM:
        return
    text = str(delta or "")
    chat_id = session.current_chat_id()
    if not text or not chat_id:
        return
    with _lock:
        _live.setdefault(chat_id, []).append(text)
    sink = _sink
    if sink is None:
        return
    try:
        sink(chat_id, text)
    except Exception:
        logger.debug("yui: reasoning sink failed", exc_info=True)


def live_text(chat_id: str) -> str:
    """Everything streamed for the turn in flight, in the order it arrived."""
    with _lock:
        return "".join(_live.get(chat_id, []))


def clear(chat_id: str) -> None:
    """A new turn reasons from nothing."""
    with _lock:
        _live.pop(chat_id, None)
