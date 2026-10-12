"""The blocking handler Hermes worker threads run for a client-declared tool."""

from __future__ import annotations

import concurrent.futures
import logging
import uuid
from typing import Any

from ..turns import session, state
from . import pending

logger = logging.getLogger(__name__)

# The client bounds its own execution (15 s body action, 2 s query); the adapter waits 5 s past each.
WAITS_S = {"body_action": 20.0, "look": 7.0}
DEFAULT_WAIT_S = 20.0

_sink: Any = None


def set_sink(sink: Any) -> None:
    """Who can put a frame on a client socket; the adapter sets itself at connect()."""
    global _sink
    _sink = sink


def handle(name: str):
    """The handler for one declared tool name; it blocks its caller's thread."""

    def run(args: dict, **_kwargs: Any) -> str:
        return _call(name, args)

    return run


def _call(name: str, args: object) -> str:
    chat_id = session.current_chat_id()
    if not chat_id or not state.is_connected(chat_id):
        return pending.DISCONNECTED
    call_id = uuid.uuid4().hex
    # Entered before the lock, so a stop or a close reaches a call still waiting its turn on it.
    turn_id = state.turn_id(chat_id) or ""
    future = pending.register(chat_id, call_id, turn_id)
    try:
        with pending.chat_lock(chat_id):
            return _send_and_wait(chat_id, call_id, turn_id, name, args, future)
    finally:
        pending.discard(chat_id, call_id)


def _send_and_wait(
    chat_id: str,
    call_id: str,
    turn_id: str,
    name: str,
    args: object,
    future: concurrent.futures.Future,
) -> str:
    # A call that waited long on the lock may find its answer in, or its client gone.
    if future.done():
        return future.result()
    if not state.is_connected(chat_id):
        return pending.DISCONNECTED
    wait = WAITS_S.get(name, DEFAULT_WAIT_S)
    frame = {
        "type": "tool_call",
        "id": call_id,
        "turn_id": turn_id,
        "name": name,
        "arguments": args if isinstance(args, dict) else {},
    }
    sink = _sink
    if sink is None or not sink.send_tool_call(chat_id, frame):
        return pending.DISCONNECTED
    try:
        return future.result(timeout=wait)
    except concurrent.futures.TimeoutError:
        logger.info("yui: tool_call %s got no reply in %s s chat=%s", name, int(wait), chat_id)
        return f"error: no reply from the client within {int(wait)} s"
