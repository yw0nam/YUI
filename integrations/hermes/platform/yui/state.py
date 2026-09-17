"""Per-chat runtime state: the turn in flight, its cues, and who has a ready socket."""

from __future__ import annotations

import threading

from .gate import Vocabulary
from .segments import Placement

_lock = threading.Lock()
_vocabularies: dict[str, Vocabulary] = {}
_cues: dict[str, list[Placement]] = {}
_turn_ids: dict[str, str] = {}
_delivered: set[str] = set()
_connected: set[str] = set()
_muted: set[str] = set()


def set_vocabulary(chat_id: str, vocab: Vocabulary) -> None:
    with _lock:
        _vocabularies[chat_id] = vocab


def vocabulary(chat_id: str) -> Vocabulary:
    with _lock:
        return _vocabularies.get(chat_id) or Vocabulary()


def set_turn_id(chat_id: str, turn_id: str) -> None:
    with _lock:
        _turn_ids[chat_id] = turn_id


def turn_id(chat_id: str) -> str | None:
    """The turn in flight; every reply of a turn names it."""
    with _lock:
        return _turn_ids.get(chat_id)


def take_turn_id(chat_id: str) -> str | None:
    """The turn in flight, cleared — the turn is over."""
    with _lock:
        return _turn_ids.pop(chat_id, None)


def append_cue(chat_id: str, cue: dict, sentence: str) -> None:
    """Buffer one gated cue for the turn in flight; an all-empty cue carries nothing."""
    if not cue:
        return
    with _lock:
        _cues.setdefault(chat_id, []).append(Placement(cue, sentence))


def pop_cues(chat_id: str) -> list[Placement]:
    """Take the cues buffered for this chat, in the order the model listed them."""
    with _lock:
        return _cues.pop(chat_id, [])


def mark_delivered(chat_id: str) -> None:
    """Record that this turn already reached the client, so its end needs no empty render."""
    with _lock:
        _delivered.add(chat_id)


def take_delivered(chat_id: str) -> bool:
    """Whether the turn that just ended had delivered speech; clears the mark."""
    with _lock:
        had = chat_id in _delivered
        _delivered.discard(chat_id)
        return had


def set_muted(chat_id: str, muted: bool) -> None:
    """Arm or disarm swallowing the next final reply for this chat."""
    with _lock:
        if muted:
            _muted.add(chat_id)
        else:
            _muted.discard(chat_id)


def take_muted(chat_id: str) -> bool:
    """Whether this chat's next final reply stays unspoken; clears the mark."""
    with _lock:
        muted = chat_id in _muted
        _muted.discard(chat_id)
        return muted


def set_connected(chat_id: str, connected: bool) -> None:
    with _lock:
        if connected:
            _connected.add(chat_id)
        else:
            _connected.discard(chat_id)


def is_connected(chat_id: str) -> bool:
    with _lock:
        return chat_id in _connected


def connected_chats() -> list[str]:
    with _lock:
        return sorted(_connected)


def reset(chat_id: str) -> None:
    """Drop a stale buffer when a new turn opens, so a dead turn's cues never ride along."""
    with _lock:
        _cues.pop(chat_id, None)
        _delivered.discard(chat_id)
