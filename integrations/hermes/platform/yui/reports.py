"""Reports that arrive while no client socket is ready, held until one is."""

from __future__ import annotations

import threading

MAX_QUEUED = 20

_HEADER = (
    "While the client was disconnected, {count} reports arrived{dropped}. "
    "Summarise them for the user in one short reply, most important first."
)

_lock = threading.Lock()
_queues: dict[str, list] = {}
_dropped: dict[str, int] = {}


def queue(chat_id: str, report: object) -> None:
    """Hold one report for this chat; past the cap the oldest goes and is counted."""
    with _lock:
        held = _queues.setdefault(chat_id, [])
        held.append(report)
        while len(held) > MAX_QUEUED:
            held.pop(0)
            _dropped[chat_id] = _dropped.get(chat_id, 0) + 1


def take(chat_id: str) -> tuple[list, int]:
    """The reports held for this chat and how many were dropped; clears both."""
    with _lock:
        return _queues.pop(chat_id, []), _dropped.pop(chat_id, 0)


def merged_text(texts: list[str], dropped: int) -> str:
    """One turn's text for several reports: what to do with them, then each report."""
    dropped_note = f" ({dropped} older ones dropped)" if dropped else ""
    header = _HEADER.format(count=len(texts), dropped=dropped_note)
    return "\n\n".join([header, *texts])
