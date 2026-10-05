"""Outbox item rules and the pent-up stage of a held note."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path

if __package__:
    from . import desire_config, desire_store
else:
    import desire_config
    import desire_store

OUTBOX_EXPIRY = timedelta(hours=48)
PENT_UP_HEAVY = timedelta(hours=6)
PENT_UP_BURSTING = timedelta(hours=18)


def stamp_outbox(path: Path, item_ids: tuple[str, ...], now: datetime) -> None:
    """Stamp selected valid items while preserving malformed lines for the monitor."""

    now = desire_config.normalize_now(now)
    path = Path(path)
    with desire_store.state_lock(path.parent):
        ids = set(item_ids)
        parts = path.read_text(encoding="utf-8").split("\n")
        changed = False
        rewritten = []
        for index, payload in enumerate(parts):
            ending = "\n" if index < len(parts) - 1 else ""
            line = payload + ending
            try:
                item = json.loads(payload)
            except (json.JSONDecodeError, UnicodeError):
                rewritten.append(line)
                continue
            if valid_outbox_item(item) and item.get("id") in ids and item.get("surfaced_at") is None:
                item["surfaced_at"] = now.isoformat()
                rewritten.append(json.dumps(item, ensure_ascii=False) + ending)
                changed = True
            else:
                rewritten.append(line)
        if changed:
            temporary = path.with_name(path.name + ".tmp")
            temporary.write_text("".join(rewritten), encoding="utf-8", newline="")
            os.replace(temporary, path)


def release_outbox_item(path: Path, item_id: str) -> bool:
    """Remove one item by id while preserving every other line's bytes exactly.

    Operates on raw bytes so a malformed line's original line ending (including CRLF) and any
    invalid-UTF-8 bytes survive untouched. Returns whether the item was found.
    """

    path = Path(path)
    with desire_store.state_lock(path.parent):
        if not path.exists():
            return False
        parts = path.read_bytes().split(b"\n")
        found = False
        rewritten = []
        for index, payload in enumerate(parts):
            ending = b"\n" if index < len(parts) - 1 else b""
            line = payload + ending
            try:
                item = json.loads(payload.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeError):
                rewritten.append(line)
                continue
            if isinstance(item, dict) and item.get("id") == item_id:
                found = True
                continue
            rewritten.append(line)
        if found:
            temporary = path.with_name(path.name + ".tmp")
            temporary.write_bytes(b"".join(rewritten))
            os.replace(temporary, path)
        return found


def update_outbox_item(path: Path, item_id: str, fields: dict) -> bool:
    """Merge ``fields`` into one item by id, preserving every other line's bytes exactly."""

    path = Path(path)
    with desire_store.state_lock(path.parent):
        if not path.exists():
            return False
        parts = path.read_bytes().split(b"\n")
        found = False
        rewritten = []
        for index, payload in enumerate(parts):
            ending = b"\n" if index < len(parts) - 1 else b""
            try:
                item = json.loads(payload.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeError):
                rewritten.append(payload + ending)
                continue
            if isinstance(item, dict) and item.get("id") == item_id:
                found = True
                rewritten.append(json.dumps({**item, **fields}, ensure_ascii=False).encode("utf-8") + ending)
                continue
            rewritten.append(payload + ending)
        if found:
            temporary = path.with_name(path.name + ".tmp")
            temporary.write_bytes(b"".join(rewritten))
            os.replace(temporary, path)
        return found


def valid_outbox_item(item: object) -> bool:
    if not isinstance(item, dict) or not isinstance(item.get("id"), str):
        return False
    try:
        desire_config.parse_timestamp(item["created_at"])
        for key in ("surfaced_at", "not_before"):
            stamp = item.get(key)
            if stamp is not None:
                desire_config.parse_timestamp(stamp)
    except (KeyError, TypeError, ValueError):
        return False
    return True


def active_outbox(items: list[dict], now: datetime) -> list[dict]:
    """Return every valid item younger than ``OUTBOX_EXPIRY``.

    Surfacing (see ``stamp_outbox``) does not retire an item; it stays pent-up until it is
    explicitly released (``act.py outbox --release``) or ages past ``OUTBOX_EXPIRY``.
    """

    now = desire_config.normalize_now(now)
    active = []
    for item in items:
        if not valid_outbox_item(item):
            continue
        age = now - desire_config.parse_timestamp(item["created_at"])
        if timedelta(0) <= age < OUTBOX_EXPIRY:
            active.append(item)
    return active


def visible_outbox(items: list[dict], now: datetime) -> list[dict]:
    """Return every active item that is not postponed past ``now``."""

    now = desire_config.normalize_now(now)
    return [
        item
        for item in active_outbox(items, now)
        if item.get("not_before") is None or desire_config.parse_timestamp(item["not_before"]) <= now
    ]


def pent_up_stage(created_at: datetime, now: datetime) -> str:
    waited = desire_config.normalize_now(now) - desire_config.normalize_now(created_at)
    if waited >= PENT_UP_BURSTING:
        return "bursting"
    if waited >= PENT_UP_HEAVY:
        return "heavy"
    return "fresh"
