"""Drive stamps: defaults, normalization, and the read-only snapshot."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

if __package__:
    from . import desire_config
else:
    import desire_config


def _default_drives(now: datetime) -> dict:
    stamp = now.isoformat()
    return {
        "last_interaction_at": stamp,
        "last_interaction_hash": None,
        "last_signal_at": None,
        "last_signal_answered_at": None,
    }


def default_drives(now: datetime) -> dict:
    return _default_drives(desire_config.normalize_now(now))


def _normalize_drives(value: object) -> dict:
    if not isinstance(value, dict):
        raise TypeError("drives state must be an object")
    interaction_hash = value.get("last_interaction_hash")
    if interaction_hash is not None and not isinstance(interaction_hash, str):
        raise ValueError("last interaction hash must be text or null")
    result = {
        "last_interaction_at": desire_config.parse_timestamp(value["last_interaction_at"]).isoformat(),
        "last_interaction_hash": interaction_hash,
    }
    for key in ("last_signal_at", "last_signal_answered_at"):
        stamp = value.get(key)
        result[key] = desire_config.parse_timestamp(stamp).isoformat() if stamp is not None else None
    return result


def read_drives_snapshot(state_dir: Path, now: datetime) -> dict:
    """Read drives without recovery writes. The caller holds ``state_lock`` when state exists."""

    now = desire_config.normalize_now(now)
    try:
        value = json.loads((Path(state_dir) / "drives.json").read_text(encoding="utf-8"))
        return _normalize_drives(value)
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError, UnicodeError, OSError, ValueError):
        return _default_drives(now)
