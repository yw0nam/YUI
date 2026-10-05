"""Drive defaults, normalization, decay math, and the monitor record."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

if __package__:
    from . import desire_config
else:
    import desire_config

CURIOSITY_RATE = 9.0
ACCOMPLISHMENT_RATE = 6.0
SOCIAL_RATE = 15.0
DRIVES = ("social", "curiosity", "accomplishment")
BUCKETS = ("low", "mid", "high")
EVENT_DOSES = {
    "learned": {"curiosity": 30.0},
    "progressed": {"accomplishment": 15.0},
    "shipped": {"accomplishment": 40.0},
    "praised": {"accomplishment": 25.0},
}


def _default_drives(now: datetime) -> dict:
    stamp = now.isoformat()
    return {
        "curiosity": {"level": 50.0, "anchor_at": stamp},
        "accomplishment": {"level": 50.0, "anchor_at": stamp},
        "last_interaction_at": stamp,
        "last_interaction_hash": None,
        "last_signal_at": None,
        "last_signal_answered_at": None,
    }


def default_drives(now: datetime) -> dict:
    return _default_drives(desire_config.normalize_now(now))


def _default_monitor(drives: dict, now: datetime) -> dict:
    levels = drive_levels(drives, now)
    buckets = {name: bucket(levels[name]) for name in DRIVES}
    return {
        "latched": buckets,
        "natural": dict(buckets),
        "rises": 0,
        "saturated_since": {name: None for name in DRIVES},
    }


def _normalize_drives(value: object) -> dict:
    if not isinstance(value, dict):
        raise TypeError("drives state must be an object")
    result = {}
    for name in ("curiosity", "accomplishment"):
        drive = value[name]
        if not isinstance(drive, dict):
            raise TypeError("drive state must be an object")
        result[name] = {
            "level": float(drive["level"]),
            "anchor_at": desire_config.parse_timestamp(drive["anchor_at"]).isoformat(),
        }
    interaction_hash = value.get("last_interaction_hash")
    if interaction_hash is not None and not isinstance(interaction_hash, str):
        raise ValueError("last interaction hash must be text or null")
    result["last_interaction_at"] = desire_config.parse_timestamp(value["last_interaction_at"]).isoformat()
    result["last_interaction_hash"] = interaction_hash
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


def _normalize_buckets(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise TypeError("monitor buckets must be an object")
    buckets = {name: value[name] for name in DRIVES}
    if any(name not in BUCKETS for name in buckets.values()):
        raise ValueError("unknown bucket name")
    return buckets


def _normalize_saturation(value: object) -> dict[str, str | None]:
    """Read the per-drive saturation stamps, treating an absent record as unsaturated."""

    stamps = value if isinstance(value, dict) else {}
    return {
        name: None if stamps.get(name) is None else desire_config.parse_timestamp(stamps[name]).isoformat()
        for name in DRIVES
    }


def _normalize_monitor(value: object) -> dict:
    if not isinstance(value, dict):
        raise TypeError("monitor state must be an object")
    rises = value["rises"]
    if isinstance(rises, bool) or not isinstance(rises, int) or rises < 0:
        raise ValueError("rise count must be a whole number")
    return {
        "latched": _normalize_buckets(value["latched"]),
        "natural": _normalize_buckets(value["natural"]),
        "rises": rises,
        "saturated_since": _normalize_saturation(value.get("saturated_since")),
    }


def _elapsed_hours(anchor: str, now: datetime) -> float:
    seconds = (now - desire_config.parse_timestamp(anchor)).total_seconds()
    return max(0.0, seconds) / 3600.0


def _clamp(level: float) -> float:
    return min(100.0, max(0.0, float(level)))


def drive_levels(drives: dict, now: datetime) -> dict[str, float]:
    now = desire_config.normalize_now(now)
    curiosity = drives["curiosity"]
    accomplishment = drives["accomplishment"]
    return {
        "social": _clamp(SOCIAL_RATE * _elapsed_hours(drives["last_interaction_at"], now)),
        "curiosity": _clamp(
            float(curiosity["level"]) + CURIOSITY_RATE * _elapsed_hours(curiosity["anchor_at"], now)
        ),
        "accomplishment": _clamp(
            float(accomplishment["level"])
            + ACCOMPLISHMENT_RATE * _elapsed_hours(accomplishment["anchor_at"], now)
        ),
    }


def bucket(level: float) -> str:
    if level < 40:
        return "low"
    if level < 70:
        return "mid"
    return "high"


def displayed_level(level: float) -> int:
    return int(level)


def homeostatic_drive(levels: dict[str, float]) -> float:
    return (
        sum((float(levels[name]) / 100.0) ** 4 for name in ("social", "curiosity", "accomplishment")) ** 0.5
    )
