"""Bootstrap of the state files and the daily budget."""

from __future__ import annotations

import copy
from datetime import date, datetime
from pathlib import Path

if __package__:
    from . import desire_config, desire_drives, desire_store
else:
    import desire_config
    import desire_drives
    import desire_store

CAPS = {"signals": 3, "issues": 2, "self_comments": 1, "prs": 0}


def _default_budget(now: datetime) -> dict:
    return {
        "date": now.date().isoformat(),
        "signals": 0,
        "issues": 0,
        "self_comments": 0,
        "prs": 0,
        "pending": {},
    }


def _default_cursor(now: datetime) -> dict:
    return {"last_feedback_check_at": now.isoformat()}


def _validate_budget(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("pending"), dict):
        raise TypeError("budget state must be an object")
    date.fromisoformat(value["date"])
    counters = {key: value[key] for key in ("signals", "issues", "self_comments", "prs")}
    if any(not isinstance(count, int) for count in counters.values()):
        raise TypeError("budget counters must be integers")
    return {**counters, "date": value["date"], "pending": copy.deepcopy(value["pending"])}


def _normalize_cursor(value: object) -> dict:
    if not isinstance(value, dict):
        raise TypeError("cursor state must be an object")
    return {
        "last_feedback_check_at": desire_config.parse_timestamp(value["last_feedback_check_at"]).isoformat()
    }


def bootstrap_locked(state_dir: Path, now: datetime) -> dict[str, dict]:
    """Ensure all state files exist. The caller must hold ``state_lock``."""

    now = desire_config.normalize_now(now)
    state_dir = Path(state_dir)
    loaded = {}
    definitions = (
        ("drives.json", lambda: desire_drives._default_drives(now), desire_drives._normalize_drives),
        ("budget.json", lambda: _default_budget(now), _validate_budget),
        ("cursor.json", lambda: _default_cursor(now), _normalize_cursor),
    )
    for filename, default, normalizer in definitions:
        loaded[filename.removesuffix(".json")] = desire_store.load_normalized_json(
            state_dir / filename, default, normalizer, now
        )
    for name in ("monitor.json", "ticks.jsonl"):
        (state_dir / name).unlink(missing_ok=True)
    for name in ("outbox.jsonl", "audit.jsonl"):
        (state_dir / name).touch(exist_ok=True)
    return loaded


def bootstrap(now: datetime) -> dict[str, dict]:
    now = desire_config.normalize_now(now)
    with desire_store.state_lock() as state_dir:
        return bootstrap_locked(state_dir, now)


def normalize_budget(budget: dict, now: datetime) -> dict:
    now = desire_config.normalize_now(now)
    today = now.date().isoformat()
    pending = budget.get("pending") if isinstance(budget.get("pending"), dict) else {}
    if budget.get("date") < today:
        return {
            "date": today,
            "signals": 0,
            "issues": 0,
            "self_comments": 0,
            "prs": 0,
            "pending": copy.deepcopy(pending),
        }
    return {
        "date": budget["date"],
        "signals": int(budget.get("signals", 0)),
        "issues": int(budget.get("issues", 0)),
        "self_comments": int(budget.get("self_comments", 0)),
        "prs": int(budget.get("prs", 0)),
        "pending": copy.deepcopy(pending),
    }


def reservation_is_older_than(pending: dict, cutoff: date) -> bool:
    """Return whether a dated reservation predates a gate cutoff."""

    try:
        return date.fromisoformat(pending["date"]) < cutoff
    except (KeyError, TypeError, ValueError):
        return True
