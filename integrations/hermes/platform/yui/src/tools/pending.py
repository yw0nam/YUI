"""Per-chat pending tool calls: the in-flight lock, the waiter table, and the failure fan-out."""

from __future__ import annotations

import concurrent.futures
import threading
from dataclasses import dataclass

from .image_result import ImageResult, client_result

DISCONNECTED = "error: client disconnected"
TURN_STOPPED = "error: turn stopped"


@dataclass
class _Call:
    future: concurrent.futures.Future
    turn_id: str


_lock = threading.Lock()
_locks: dict[str, threading.Lock] = {}
_calls: dict[str, dict[str, _Call]] = {}


def chat_lock(chat_id: str) -> threading.Lock:
    """The chat's in-flight lock; one tool call at a time per chat."""
    with _lock:
        lock = _locks.get(chat_id)
        if lock is None:
            lock = threading.Lock()
            _locks[chat_id] = lock
        return lock


def register(chat_id: str, call_id: str, turn_id: str) -> concurrent.futures.Future:
    """Open one pending entry; the handler waits on the future it returns."""
    future: concurrent.futures.Future = concurrent.futures.Future()
    with _lock:
        _calls.setdefault(chat_id, {})[call_id] = _Call(future, turn_id)
    return future


def resolve(chat_id: str, call_id: str, result: str, images: object = None) -> bool:
    """Complete one pending call with the client's result; False for an unknown id."""
    with _lock:
        call = _calls.get(chat_id, {}).get(call_id)
    if call is None:
        return False
    _complete(call.future, client_result(result, images))
    return True


def discard(chat_id: str, call_id: str) -> None:
    """Remove one entry; the handler's finally runs this on every path."""
    with _lock:
        held = _calls.get(chat_id)
        if held is not None:
            held.pop(call_id, None)
            if not held:
                del _calls[chat_id]


def fail(chat_id: str, message: str, turn_ids: set[str] | None = None) -> int:
    """Complete every pending call of the chat — or of the named turns — with the message, those still waiting on the lock included."""
    with _lock:
        held = _calls.get(chat_id)
        if not held:
            return 0
        if turn_ids is None:
            calls = list(held.values())
            del _calls[chat_id]
        else:
            named = [call_id for call_id, call in held.items() if call.turn_id in turn_ids]
            calls = [held.pop(call_id) for call_id in named]
            if not held:
                del _calls[chat_id]
    for call in calls:
        _complete(call.future, message)
    return len(calls)


def _complete(future: concurrent.futures.Future, result: str | ImageResult) -> None:
    if future.done():
        return
    try:
        future.set_result(result)
    except concurrent.futures.InvalidStateError:
        pass
