"""Per-chat runtime state: the open turns, their cues, and who has a ready socket."""

from __future__ import annotations

import threading

from .gate import Vocabulary
from .segments import Placement

_lock = threading.Lock()
_vocabularies: dict[str, Vocabulary] = {}
_cues: dict[str, list[Placement]] = {}
_open_turns: dict[str, list[str]] = {}
_joined: dict[str, list[str]] = {}
_arrival: dict[str, list[str]] = {}
_closing: set[str] = set()
_delivered: set[str] = set()
_connected: set[str] = set()
_muted: set[str] = set()


def set_vocabulary(chat_id: str, vocab: Vocabulary) -> None:
    with _lock:
        _vocabularies[chat_id] = vocab


def vocabulary(chat_id: str) -> Vocabulary | None:
    """This chat's published vocabulary, or None when it has never published one."""
    with _lock:
        return _vocabularies.get(chat_id)


def open_turn(chat_id: str, turn_id: str) -> None:
    """Open one more turn; the backend can run a later turn inside one already open."""
    with _lock:
        _open_turns.setdefault(chat_id, []).append(turn_id)
        _arrival.setdefault(chat_id, []).append(turn_id)


def turn_id(chat_id: str) -> str | None:
    """The most recently arrived turn, open or joined; every reply names it."""
    with _lock:
        arrival = _arrival.get(chat_id)
        return arrival[-1] if arrival else None


def open_turns(chat_id: str) -> list[str]:
    """The turns still open on this chat, in the order they opened."""
    with _lock:
        return list(_open_turns.get(chat_id, ()))


def close_turns(chat_id: str) -> list[str]:
    """Every open turn most recently opened first, then the turns that joined them, cleared."""
    with _lock:
        open_first = reversed(_open_turns.pop(chat_id, []))
        _arrival.pop(chat_id, None)
        return [*open_first, *reversed(_joined.pop(chat_id, []))]


def mark_joined(chat_id: str, turn_id: str) -> None:
    """Record a turn the backend took while this chat was busy, in arrival order."""
    with _lock:
        _joined.setdefault(chat_id, []).append(turn_id)
        _arrival.setdefault(chat_id, []).append(turn_id)


def drop_joined(chat_id: str, turn_id: str) -> None:
    """Forget one mark; a turn the gateway ran on its own was never a joined one."""
    with _lock:
        held = _joined.get(chat_id)
        if held is None or turn_id not in held:
            return
        held.remove(turn_id)
        if not held:
            del _joined[chat_id]
        arrival = _arrival.get(chat_id)
        if arrival is not None and turn_id in arrival:
            arrival.remove(turn_id)


def forget_joined(chat_id: str) -> None:
    """Drop every mark on this chat; a departed client's ids mean nothing to the next one."""
    with _lock:
        forgotten = _joined.pop(chat_id, [])
        arrival = _arrival.get(chat_id)
        if arrival is not None:
            _arrival[chat_id] = [turn for turn in arrival if turn not in forgotten]


def mark_closing(chat_id: str) -> None:
    """Arm ending this chat's open turns behind the failure line the gateway still owes."""
    with _lock:
        _closing.add(chat_id)


def take_closing(chat_id: str) -> bool:
    """Whether this chat's open turns are waiting on a failure line; clears the mark."""
    with _lock:
        closing = chat_id in _closing
        _closing.discard(chat_id)
        return closing


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


def cues(chat_id: str) -> list[Placement]:
    """The cues buffered for this chat, left in the buffer."""
    with _lock:
        return list(_cues.get(chat_id, ()))


def drop_cues(chat_id: str, placements: list[Placement]) -> None:
    """Take these cues out of the buffer, leaving the rest in order."""
    with _lock:
        held = _cues.get(chat_id, [])
        for placement in placements:
            if placement in held:
                held.remove(placement)


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


def is_muted(chat_id: str) -> bool:
    """Whether this chat's next final reply stays unspoken; leaves the mark."""
    with _lock:
        return chat_id in _muted


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
