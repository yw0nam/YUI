"""Witness activity log → one day of segments.

The YUI client writes transition-only JSONL to `<app_data_dir>/witness/activity_YYYY-MM-DD.jsonl`
(format: `docs/reference/witness-log.md`). This module turns those transitions back into the
intervals they imply. Pure file reading and arithmetic — no OS calls, no judgment.
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger

LOG_DIR_ENV = "WITNESS_LOG_DIR"
DEFAULT_LOG_DIR = Path.home() / "Library/Application Support/com.yui.desktop/witness"

_RECORD_TYPES = ("app_change", "idle_start", "idle_end")


def log_dir() -> Path:
    """Witness log directory — `WITNESS_LOG_DIR`, else the macOS app data dir."""
    raw = os.getenv(LOG_DIR_ENV, "").strip()
    return Path(raw).expanduser() if raw else DEFAULT_LOG_DIR


def timeline(date: str) -> dict[str, Any]:
    """Segments for one day. A missing directory or day file is an empty timeline."""
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return {"error": f"Invalid date: {date!r}. Expected YYYY-MM-DD."}
    records = _read(log_dir() / f"activity_{date}.jsonl")
    return {"date": date, "segments": _segments(records, date)}


def _read(path: Path) -> list[dict[str, Any]]:
    """Parse a day file into timestamp-ordered records, skipping unreadable lines."""
    if not path.is_file():
        return []
    records = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        record = _parse(line)
        if record is None:
            logger.warning(f"witness: skipping unreadable line in {path.name}: {line[:120]!r}")
            continue
        records.append(record)
    records.sort(key=lambda record: record["at"])
    return records


def _parse(line: str) -> dict[str, Any] | None:
    """One JSONL line → record, or None when it is corrupt or of an unknown type."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, dict) or raw.get("type") not in _RECORD_TYPES:
        return None
    try:
        at = datetime.fromisoformat(raw["ts"])
    except (KeyError, TypeError, ValueError):
        return None
    return {
        "at": at,
        "type": raw["type"],
        "app": raw.get("app"),
        "window_title": raw.get("window_title"),
    }


def _segments(records: list[dict[str, Any]], date: str) -> list[dict[str, Any]]:
    """Walk the transitions, holding one open segment and closing it at the next boundary.

    An `app_change` for the app already open only refreshes its title, so title changes never
    split a segment. A day whose first record is `idle_end` was idle across the midnight
    rotation, so that idle counts from 00:00. The segment the last record opens ends at that
    record's timestamp — nothing after it was observed — which gives it a zero duration.
    """
    if not records:
        return []

    segments: list[dict[str, Any]] = []
    open_segment: dict[str, Any] | None = None
    if records[0]["type"] == "idle_end":
        open_segment = {"type": "idle", "start": _day_start(date, records[0]["at"])}

    for record in records:
        at, kind = record["at"], record["type"]
        active = open_segment is not None and open_segment["type"] == "app"
        if kind == "app_change":
            if active and open_segment["app"] == record["app"]:
                open_segment["window_title"] = record["window_title"]
                continue
            following = _app_segment(at, record)
        elif kind == "idle_start":
            if open_segment is not None and not active:
                continue
            following = {"type": "idle", "start": at}
        else:
            if active:
                continue
            following = _app_segment(at, record)
        _close(segments, open_segment, at)
        open_segment = following

    _close(segments, open_segment, records[-1]["at"])
    return segments


def _app_segment(at: datetime, record: dict[str, Any]) -> dict[str, Any]:
    return {"type": "app", "start": at, "app": record["app"], "window_title": record["window_title"]}


def _close(segments: list[dict[str, Any]], segment: dict[str, Any] | None, at: datetime) -> None:
    """Emit the open segment, ended at `at`. Never runs backwards, whatever the log says."""
    if segment is None:
        return
    start = segment["start"]
    end = max(start, at)
    closed = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "type": segment["type"],
    }
    if segment["type"] == "app":
        closed["app"] = segment["app"]
        closed["window_title"] = segment["window_title"]
    closed["duration_min"] = round((end - start).total_seconds() / 60, 1)
    segments.append(closed)


def _day_start(date: str, reference: datetime) -> datetime:
    """Midnight of `date` in the offset the log is written with."""
    return datetime.fromisoformat(date).replace(tzinfo=reference.tzinfo)
