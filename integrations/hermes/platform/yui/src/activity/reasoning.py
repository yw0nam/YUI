"""The backend's reasoning as it is streamed.

Live tokens arrive on the ``on_stream_delta`` hook with ``kind="reasoning"``, on a hook worker
thread, and only while the gateway's ``plugins.stream_reasoning_deltas`` is on. ``live_text``
hands the text written so far for the turn in flight to the ``render`` frame that closes it.
The ``Coalescer`` sends what streams as one frame per window.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
from collections.abc import Awaitable, Callable

from ..turns import session

logger = logging.getLogger(__name__)

PLATFORM = "yui"

_lock = threading.Lock()
_live: dict[str, list[str]] = {}
_sink: Callable[[str, str], None] | None = None


def set_sink(callback: Callable[[str, str], None] | None) -> None:
    """Who to hand a delta to; the adapter puts them on its loop for the ``Coalescer``."""
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


# One reasoning frame per window, so a token stream does not become a frame stream.
WINDOW_SECONDS = 0.1


class Coalescer:
    """Each chat's streamed reasoning, joined per window and handed to ``send``; runs on the adapter's loop."""

    def __init__(self, send: Callable[[str, str], Awaitable[None]]) -> None:
        self._send = send
        self.pending: dict[str, list[str]] = {}
        self.flushes: dict[str, asyncio.Task] = {}

    def collect(self, chat_id: str, delta: str) -> None:
        self.pending.setdefault(chat_id, []).append(delta)
        self._arm(chat_id)

    def forget(self, chat_id: str) -> None:
        """A new turn thinks from nothing, so the last one's tail is not its opening words."""
        # Pending goes first: a cancelled flush re-arms from its finally only when pending is non-empty.
        self.pending.pop(chat_id, None)
        flush = self.flushes.pop(chat_id, None)
        if flush is not None:
            flush.cancel()

    def close(self) -> None:
        for flush in tuple(self.flushes.values()):
            flush.cancel()
        self.flushes.clear()
        self.pending.clear()

    async def flush(self, chat_id: str) -> None:
        """What arrived during the window leaves as one frame; the client shows thinking, not text."""
        try:
            await asyncio.sleep(WINDOW_SECONDS)
            delta = "".join(self.pending.pop(chat_id, []))
            if delta:
                await self._send(chat_id, delta)
        finally:
            # No running loop only when the coroutine is collected after loop teardown.
            with contextlib.suppress(RuntimeError):
                if self.flushes.get(chat_id) is asyncio.current_task():
                    self.flushes.pop(chat_id, None)
                # A delta that arrived during the send found this flush still armed and scheduled none.
                if self.pending.get(chat_id):
                    self._arm(chat_id)

    def _arm(self, chat_id: str) -> None:
        if chat_id not in self.flushes:
            self.flushes[chat_id] = asyncio.create_task(self.flush(chat_id))
