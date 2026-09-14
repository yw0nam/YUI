"""What the client misses while no socket is ready: replies already rendered, and reports."""

from __future__ import annotations

import threading

MAX_QUEUED = 20

_HEADER = (
    "While the client was disconnected, {count} reports arrived{dropped}. "
    "Summarise them for the user in one short reply, most important first."
)

_lock = threading.Lock()
_reports: dict[str, list] = {}
_reports_dropped: dict[str, int] = {}
_renders: dict[str, list] = {}
_renders_dropped: dict[str, int] = {}


def _push(held: dict, dropped: dict, chat_id: str, item: object) -> None:
    """Past the cap the oldest goes and is counted."""
    with _lock:
        queued = held.setdefault(chat_id, [])
        queued.append(item)
        while len(queued) > MAX_QUEUED:
            queued.pop(0)
            dropped[chat_id] = dropped.get(chat_id, 0) + 1


def _pop(held: dict, dropped: dict, chat_id: str) -> tuple[list, int]:
    with _lock:
        return held.pop(chat_id, []), dropped.pop(chat_id, 0)


def queue(chat_id: str, report: object) -> None:
    """Hold one report for this chat."""
    _push(_reports, _reports_dropped, chat_id, report)


def take(chat_id: str) -> tuple[list, int]:
    """The reports held for this chat and how many were dropped; clears both."""
    return _pop(_reports, _reports_dropped, chat_id)


def queue_render(chat_id: str, frame: dict) -> None:
    """Hold one finished reply for this chat."""
    _push(_renders, _renders_dropped, chat_id, frame)


def take_renders(chat_id: str) -> tuple[list, int]:
    """The replies held for this chat and how many were dropped; clears both."""
    return _pop(_renders, _renders_dropped, chat_id)


def merged_text(texts: list[str], dropped: int) -> str:
    """One turn's text for several reports: what to do with them, then each report."""
    dropped_note = f" ({dropped} older ones dropped)" if dropped else ""
    header = _HEADER.format(count=len(texts), dropped=dropped_note)
    return "\n\n".join([header, *texts])
