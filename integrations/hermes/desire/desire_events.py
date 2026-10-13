"""The event and reading logs: their writers, line validity, the shown state and the unread events."""

from __future__ import annotations

import re
import secrets
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path

if __package__:
    from . import desire_config, desire_store
else:
    import desire_config
    import desire_store

_EVENT_ID = re.compile(r"^e-[0-9a-f]{6}$")
_READING_ID = re.compile(r"^r-[0-9a-f]{6}$")
SOURCES = ("agent", "monitor")


class UnknownEventError(ValueError):
    """The id names no valid event."""


class RetractedEventError(ValueError):
    """The id names an event that was retracted."""


def _stamped(line: dict) -> bool:
    """Report whether the line carries a parseable ``at`` timestamp."""

    try:
        desire_config.parse_timestamp(line["at"])
    except (KeyError, TypeError, ValueError):
        return False
    return True


def _event_id_of(line: dict) -> str | None:
    """Return the id when the line is a valid event, else ``None``."""

    event_id = line.get("id")
    if not isinstance(event_id, str) or _EVENT_ID.fullmatch(event_id) is None:
        return None
    if line.get("source") not in ("agent", "monitor"):
        return None
    fact = line.get("fact")
    if not isinstance(fact, str) or not fact or not _stamped(line):
        return None
    return event_id


def _retracts_of(line: dict) -> str | None:
    """Return the retracted id when the line is a valid retraction, else ``None``."""

    if not isinstance(line.get("retracts"), str) or not isinstance(line.get("why"), str):
        return None
    return line["retracts"] if _stamped(line) else None


def _corrects_of(line: dict) -> str | None:
    """Return the corrected id when the line is a valid correction, else ``None``."""

    fact = line.get("fact")
    if not isinstance(line.get("corrects"), str) or not isinstance(fact, str) or not fact:
        return None
    return line["corrects"] if _stamped(line) else None


def _event_id_read_by(line: dict) -> str | None:
    """Return the event id when the line is a valid reading, else ``None``."""

    reading_id = line.get("id")
    if not isinstance(reading_id, str) or _READING_ID.fullmatch(reading_id) is None:
        return None
    if not isinstance(line.get("event_id"), str) or not isinstance(line.get("text"), str):
        return None
    return line["event_id"] if _stamped(line) else None


def _read_log(state_dir: Path) -> dict[str, dict]:
    """Return every valid event by id in file order, with its shown fact, retraction and latest reading."""

    state_dir = Path(state_dir)
    events: dict[str, dict] = {}
    facts: dict[str, str] = {}
    retracted: set[str] = set()
    for line in desire_store.read_jsonl(state_dir / "events.jsonl"):
        event_id = _event_id_of(line)
        if event_id is not None:
            events.setdefault(event_id, line)
            continue
        retracts = _retracts_of(line)
        if retracts is not None:
            retracted.add(retracts)
            continue
        corrects = _corrects_of(line)
        if corrects is not None:
            facts[corrects] = line["fact"]
    readings: dict[str, dict] = {}
    for line in desire_store.read_jsonl(state_dir / "readings.jsonl"):
        event_id = _event_id_read_by(line)
        if event_id is not None:
            readings[event_id] = line
    return {
        event_id: {
            "line": line,
            "fact": facts.get(event_id, line["fact"]),
            "retracted": event_id in retracted,
            "reading": readings.get(event_id),
        }
        for event_id, line in events.items()
    }


def _source_ref(line: dict) -> str | None:
    ref = line.get("source_ref")
    return ref if isinstance(ref, str) else None


def events_view_and_unread(state_dir: Path) -> tuple[list[dict], list[str]]:
    """Return, from one read of both logs, the shown events and the unread event ids, both in file order."""

    log = _read_log(state_dir)
    view = [
        {
            "id": event_id,
            "at": entry["line"]["at"],
            "fact": entry["fact"],
            "source": entry["line"]["source"],
            "source_ref": _source_ref(entry["line"]),
            "reading": None
            if entry["reading"] is None
            else {key: entry["reading"][key] for key in ("id", "at", "text")},
        }
        for event_id, entry in log.items()
        if not entry["retracted"]
    ]
    unread = [
        event_id for event_id, entry in log.items() if not entry["retracted"] and entry["reading"] is None
    ]
    return view, unread


def events_view(state_dir: Path) -> list[dict]:
    """Return the events that are not retracted, in file order, as they are shown."""

    return events_view_and_unread(state_dir)[0]


def unread_event_ids(state_dir: Path) -> list[str]:
    """Return the ids of valid events that no valid retraction or reading names, in file order."""

    return events_view_and_unread(state_dir)[1]


def chronological(view: Iterable[dict]) -> list[dict]:
    """Order shown events by their time, keeping file order between equal times."""

    return sorted(view, key=lambda event: desire_config.parse_timestamp(event["at"]))


def monitor_refs(state_dir: Path) -> set[str]:
    """Return the text refs of every monitor event, retracted or not."""

    return {
        ref
        for entry in _read_log(state_dir).values()
        if entry["line"]["source"] == "monitor" and (ref := _source_ref(entry["line"])) is not None
    }


def _text(value: object, name: str) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not text:
        raise ValueError(f"empty {name}")
    return text


def _new_id(path: Path, prefix: str) -> str:
    """Draw an id that no line of the file carries yet. The caller holds ``state_lock``."""

    taken = {line.get("id") for line in desire_store.read_jsonl(path)}
    candidate = prefix + secrets.token_hex(3)
    while candidate in taken:
        candidate = prefix + secrets.token_hex(3)
    return candidate


def _entry(state_dir: Path, event_id: str) -> dict:
    entry = _read_log(state_dir).get(event_id)
    if entry is None:
        raise UnknownEventError(f"unknown event {event_id}")
    return entry


def require_live(state_dir: Path, event_id: str) -> None:
    if _entry(state_dir, event_id)["retracted"]:
        raise RetractedEventError(f"event {event_id} is retracted")


def file_event(state_dir: Path, fact: str, source: str, source_ref: str | None, now: datetime) -> str:
    """Append an event and return its id."""

    fact = _text(fact, "fact")
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")
    if source_ref is not None:
        source_ref = _text(source_ref, "source_ref")
    stamp = desire_config.normalize_now(now).isoformat()
    path = Path(state_dir) / "events.jsonl"
    with desire_store.state_lock(state_dir):
        event_id = _new_id(path, "e-")
        desire_store.append_jsonl(
            path, {"id": event_id, "at": stamp, "fact": fact, "source": source, "source_ref": source_ref}
        )
    return event_id


def file_event_with_reading(
    state_dir: Path, fact: str, text: str, source_ref: str | None, now: datetime
) -> tuple[str, str]:
    """Append an agent event and its reading in one lock, so no reader sees the event alone."""

    fact = _text(fact, "fact")
    text = _text(text, "text")
    with desire_store.state_lock(state_dir):
        event_id = file_event(state_dir, fact, "agent", source_ref, now)
        return event_id, file_reading(state_dir, event_id, text, now)


def file_reading(state_dir: Path, event_id: str, text: str, now: datetime) -> str:
    """Append a reading of a live event and return its id."""

    text = _text(text, "text")
    stamp = desire_config.normalize_now(now).isoformat()
    path = Path(state_dir) / "readings.jsonl"
    with desire_store.state_lock(state_dir):
        require_live(state_dir, event_id)
        reading_id = _new_id(path, "r-")
        desire_store.append_jsonl(path, {"id": reading_id, "event_id": event_id, "at": stamp, "text": text})
    return reading_id


def correct(state_dir: Path, event_id: str, fact: str, now: datetime) -> None:
    """Append a correction of a live event's fact."""

    fact = _text(fact, "fact")
    stamp = desire_config.normalize_now(now).isoformat()
    with desire_store.state_lock(state_dir):
        require_live(state_dir, event_id)
        desire_store.append_jsonl(
            Path(state_dir) / "events.jsonl", {"corrects": event_id, "at": stamp, "fact": fact}
        )


def retract(state_dir: Path, event_id: str, why: str, now: datetime) -> bool:
    """Append a retraction, or report ``False`` without writing when the event already is retracted."""

    why = _text(why, "why")
    stamp = desire_config.normalize_now(now).isoformat()
    with desire_store.state_lock(state_dir):
        if _entry(state_dir, event_id)["retracted"]:
            return False
        desire_store.append_jsonl(
            Path(state_dir) / "events.jsonl", {"retracts": event_id, "at": stamp, "why": why}
        )
    return True
