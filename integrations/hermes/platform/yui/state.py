"""Per-chat turn state: the vocabulary of the last pushed turn and the cues fired during it."""

from __future__ import annotations

import threading

from .gate import Vocabulary

_lock = threading.Lock()
_vocabularies: dict[str, Vocabulary] = {}
_cues: dict[str, list[dict]] = {}
_turn_ids: dict[str, str] = {}
_delivered: set[str] = set()


def set_vocabulary(chat_id: str, vocab: Vocabulary) -> None:
    with _lock:
        _vocabularies[chat_id] = vocab


def vocabulary(chat_id: str) -> Vocabulary:
    with _lock:
        return _vocabularies.get(chat_id) or Vocabulary()


def set_turn_id(chat_id: str, turn_id: str) -> None:
    with _lock:
        _turn_ids[chat_id] = turn_id


def turn_id(chat_id: str) -> str:
    with _lock:
        return _turn_ids.get(chat_id, "")


def append_cue(chat_id: str, cue: dict) -> None:
    """Buffer one cue for the turn in flight; an all-empty cue carries nothing and is dropped."""
    if not cue:
        return
    with _lock:
        _cues.setdefault(chat_id, []).append(cue)


def pop_cues(chat_id: str) -> list[dict]:
    """Take the cues buffered for this chat, in the order the model fired them."""
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


def reset(chat_id: str) -> None:
    """Drop a stale buffer when a new turn opens, so a dead turn's cues never ride along."""
    with _lock:
        _cues.pop(chat_id, None)
        _delivered.discard(chat_id)
