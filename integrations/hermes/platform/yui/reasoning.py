"""The backend's reasoning, from the two places the gateway offers it.

Live tokens arrive on the ``on_stream_delta`` hook with ``kind="reasoning"``, on a hook worker
thread, and only while the gateway's ``plugins.stream_reasoning_deltas`` is on. The finished text
arrives a second way: with ``display.show_reasoning`` on for this platform the gateway prepends a
fenced block to the reply, which is speech text everywhere else and must come off before the reply
is segmented.
"""

from __future__ import annotations

import logging
import re
import threading
from collections.abc import Callable

from . import session

logger = logging.getLogger(__name__)

PLATFORM = "yui"

# The default reasoning style: the header line, the fenced body, then a blank line before the reply.
_BLOCK = re.compile("^\U0001f4ad \\*\\*Reasoning:\\*\\*\n```\n(.*?)\n```\n\n", re.DOTALL)

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


def split_block(content: str) -> tuple[str, str]:
    """The prepended reasoning block and the reply under it; text without one is the reply."""
    match = _BLOCK.match(content)
    if match is None:
        return "", content
    return match.group(1), content[match.end() :]
