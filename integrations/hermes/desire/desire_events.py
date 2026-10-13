"""The event and reading logs: line validity and the unread-events decision."""

from __future__ import annotations

import re
from pathlib import Path

if __package__:
    from . import desire_config, desire_store
else:
    import desire_config
    import desire_store

_EVENT_ID = re.compile(r"^e-[0-9a-f]{6}$")
_READING_ID = re.compile(r"^r-[0-9a-f]{6}$")


def _event_id_of(line: dict) -> str | None:
    """Return the id when the line is a valid event, else ``None``."""

    event_id = line.get("id")
    if not isinstance(event_id, str) or _EVENT_ID.fullmatch(event_id) is None:
        return None
    if line.get("source") not in ("agent", "monitor"):
        return None
    fact = line.get("fact")
    if not isinstance(fact, str) or not fact:
        return None
    try:
        desire_config.parse_timestamp(line["at"])
    except (KeyError, TypeError, ValueError):
        return None
    return event_id


def _retracts_of(line: dict) -> str | None:
    """Return the retracted id when the line is a valid retraction, else ``None``."""

    if not isinstance(line.get("retracts"), str) or not isinstance(line.get("why"), str):
        return None
    try:
        desire_config.parse_timestamp(line["at"])
    except (KeyError, TypeError, ValueError):
        return None
    return line["retracts"]


def _event_id_read_by(line: dict) -> str | None:
    """Return the event id when the line is a valid reading, else ``None``."""

    reading_id = line.get("id")
    if not isinstance(reading_id, str) or _READING_ID.fullmatch(reading_id) is None:
        return None
    if not isinstance(line.get("event_id"), str) or not isinstance(line.get("text"), str):
        return None
    try:
        desire_config.parse_timestamp(line["at"])
    except (KeyError, TypeError, ValueError):
        return None
    return line["event_id"]


def unread_event_ids(state_dir: Path) -> list[str]:
    """Return the ids of valid events that no valid retraction or reading names, in file order."""

    lines = desire_store.read_jsonl(Path(state_dir) / "events.jsonl")
    events: list[str] = []
    seen: set[str] = set()
    retracted: set[str] = set()
    read: set[str] = set()
    for line in lines:
        event_id = _event_id_of(line)
        if event_id is not None:
            if event_id not in seen:
                seen.add(event_id)
                events.append(event_id)
            continue
        retracts = _retracts_of(line)
        if retracts is not None:
            retracted.add(retracts)
            continue
        read_by = _event_id_read_by(line)
        if read_by is not None:
            read.add(read_by)
    return [event_id for event_id in events if event_id not in retracted and event_id not in read]
