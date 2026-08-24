"""Locked persistent state and deterministic serialization for yui-desire."""

from __future__ import annotations

import copy
import fcntl
import json
import os
import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
CURIOSITY_RATE = 3.0
ACCOMPLISHMENT_RATE = 2.0
SOCIAL_RATE = 5.0
OUTBOX_ACTIVE_MINUTES = 15
CAPS = {"signals": 3, "issues": 2, "self_comments": 1}

_lock_guard = threading.RLock()
_lock_local = threading.local()


def _as_kst(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(KST)


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return _as_kst(parsed)


def parse_timestamp(value: str) -> datetime:
    return _parse_time(value)


def normalize_now(value: datetime) -> datetime:
    return _as_kst(value)


def resolve_state_dir() -> Path:
    configured = os.environ.get("DESIRE_STATE_DIR")
    if configured:
        return Path(configured).expanduser()
    profile = os.environ.get("HERMES_PROFILE", "natsume2")
    return Path.home() / ".hermes" / "profiles" / profile / "desire"


@contextmanager
def state_lock(state_dir: Path | None = None) -> Iterator[Path]:
    """Hold the process-wide and filesystem lock for one state transaction.

    The context is re-entrant for helpers called during a larger transaction.
    """

    directory = Path(state_dir) if state_dir is not None else resolve_state_dir()
    directory = directory.resolve()
    with _lock_guard:
        depth = getattr(_lock_local, "depth", 0)
        if depth:
            if directory != _lock_local.directory:
                raise RuntimeError("cannot nest desire state locks for different directories")
            _lock_local.depth = depth + 1
            try:
                yield directory
            finally:
                _lock_local.depth -= 1
            return

        directory.mkdir(parents=True, exist_ok=True)
        lock_path = directory / "state.lock"
        with lock_path.open("a+b") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            _lock_local.depth = 1
            _lock_local.directory = directory
            try:
                yield directory
            finally:
                _lock_local.depth = 0
                del _lock_local.directory
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def write_json_atomic(path: Path, value: object) -> None:
    path = Path(path)
    with state_lock(path.parent):
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_bytes(_json_bytes(value))
        os.replace(temporary, path)


def _append_jsonl_locked(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, ensure_ascii=False) + "\n"
    with path.open("ab+") as stream:
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        if size:
            stream.seek(-1, os.SEEK_END)
            if stream.read(1) != b"\n":
                stream.seek(0, os.SEEK_END)
                stream.write(b"\n")
        stream.seek(0, os.SEEK_END)
        stream.write(encoded.encode("utf-8"))
        stream.flush()


def append_jsonl(path: Path, value: object) -> None:
    path = Path(path)
    with state_lock(path.parent):
        _append_jsonl_locked(path, value)


def _read_jsonl_locked(path: Path) -> tuple[list[dict], int]:
    if not path.exists():
        return [], 0
    values: list[dict] = []
    dropped = 0
    for line in path.read_text(encoding="utf-8").split("\n"):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except (json.JSONDecodeError, UnicodeError):
            dropped += 1
            continue
        if isinstance(value, dict):
            values.append(value)
        else:
            dropped += 1
    return values, dropped


def read_jsonl(path: Path) -> list[dict]:
    path = Path(path)
    with state_lock(path.parent):
        return _read_jsonl_locked(path)[0]


def read_jsonl_with_dropped(path: Path) -> tuple[list[dict], int]:
    path = Path(path)
    with state_lock(path.parent):
        return _read_jsonl_locked(path)


def _write_jsonl_atomic_locked(path: Path, values: list[dict]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    payload = "".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values)
    temporary.write_text(payload, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def write_jsonl_atomic(path: Path, values: list[dict]) -> None:
    path = Path(path)
    with state_lock(path.parent):
        _write_jsonl_atomic_locked(path, values)


def stamp_outbox(path: Path, item_ids: tuple[str, ...], now: datetime) -> None:
    """Stamp selected valid items while preserving malformed lines for the monitor."""

    now = _as_kst(now)
    path = Path(path)
    with state_lock(path.parent):
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


def _default_drives(now: datetime) -> dict:
    stamp = now.isoformat()
    return {
        "curiosity": {"level": 50.0, "anchor_at": stamp},
        "accomplishment": {"level": 50.0, "anchor_at": stamp},
        "last_interaction_at": stamp,
        "last_interaction_hash": None,
    }


def default_drives(now: datetime) -> dict:
    return _default_drives(_as_kst(now))


def _default_budget(now: datetime) -> dict:
    return {
        "date": now.date().isoformat(),
        "signals": 0,
        "issues": 0,
        "self_comments": 0,
        "pending": {},
    }


def _default_cursor(now: datetime) -> dict:
    return {"last_feedback_check_at": now.isoformat()}


def load_json(path: Path, default: object, now: datetime) -> object:
    """Load a JSON state file, quarantining and replacing corrupt content."""

    now = _as_kst(now)
    path = Path(path)
    with state_lock(path.parent):
        if not path.exists():
            value = default() if callable(default) else copy.deepcopy(default)
            write_json_atomic(path, value)
            return value
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeError, OSError):
            quarantine = path.with_name(f"{path.name}.corrupt-{now.strftime('%Y%m%d%H%M%S')}")
            os.replace(path, quarantine)
            value = default() if callable(default) else copy.deepcopy(default)
            write_json_atomic(path, value)
            _append_jsonl_locked(
                path.parent / "audit.jsonl",
                {"at": now.isoformat(), "event": "state_corrupt_recovered", "file": path.name},
            )
            return value


def _recover_invalid_json_locked(path: Path, default: object, now: datetime) -> object:
    quarantine = path.with_name(f"{path.name}.corrupt-{now.strftime('%Y%m%d%H%M%S')}")
    os.replace(path, quarantine)
    value = default() if callable(default) else copy.deepcopy(default)
    write_json_atomic(path, value)
    _append_jsonl_locked(
        path.parent / "audit.jsonl",
        {"at": now.isoformat(), "event": "state_corrupt_recovered", "file": path.name},
    )
    return value


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
            "anchor_at": _parse_time(drive["anchor_at"]).isoformat(),
        }
    interaction_hash = value.get("last_interaction_hash")
    if interaction_hash is not None and not isinstance(interaction_hash, str):
        raise ValueError("last interaction hash must be text or null")
    result["last_interaction_at"] = _parse_time(value["last_interaction_at"]).isoformat()
    result["last_interaction_hash"] = interaction_hash
    return result


def read_drives_snapshot(state_dir: Path, now: datetime) -> dict:
    """Read drives without recovery writes. The caller holds ``state_lock`` when state exists."""

    now = _as_kst(now)
    try:
        value = json.loads((Path(state_dir) / "drives.json").read_text(encoding="utf-8"))
        return _normalize_drives(value)
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError, UnicodeError, OSError, ValueError):
        return _default_drives(now)


def _validate_budget(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("pending"), dict):
        raise TypeError("budget state must be an object")
    date.fromisoformat(value["date"])
    for key in ("signals", "issues", "self_comments"):
        if not isinstance(value.get(key), int):
            raise TypeError("budget counters must be integers")
    return value


def _normalize_cursor(value: object) -> dict:
    if not isinstance(value, dict):
        raise TypeError("cursor state must be an object")
    return {"last_feedback_check_at": _parse_time(value["last_feedback_check_at"]).isoformat()}


def bootstrap_locked(state_dir: Path, now: datetime) -> dict[str, dict]:
    """Ensure all state files exist. The caller must hold ``state_lock``."""

    now = _as_kst(now)
    state_dir = Path(state_dir)
    definitions = (
        ("drives.json", lambda: _default_drives(now), _normalize_drives),
        ("budget.json", lambda: _default_budget(now), _validate_budget),
        ("cursor.json", lambda: _default_cursor(now), _normalize_cursor),
    )
    loaded = {}
    for filename, default, normalizer in definitions:
        path = state_dir / filename
        value = load_json(path, default, now)
        try:
            normalized = normalizer(value)
        except (KeyError, TypeError, ValueError):
            normalized = _recover_invalid_json_locked(path, default, now)
        if normalized != value:
            write_json_atomic(path, normalized)
        loaded[filename.removesuffix(".json")] = normalized
    for name in ("outbox.jsonl", "audit.jsonl"):
        (state_dir / name).touch(exist_ok=True)
    return loaded


def bootstrap(now: datetime) -> dict[str, dict]:
    now = _as_kst(now)
    with state_lock() as state_dir:
        return bootstrap_locked(state_dir, now)


def _elapsed_hours(anchor: str, now: datetime) -> float:
    seconds = (now - _parse_time(anchor)).total_seconds()
    return max(0.0, seconds) / 3600.0


def _clamp(level: float) -> float:
    return min(100.0, max(0.0, float(level)))


def drive_levels(drives: dict, now: datetime) -> dict[str, float]:
    now = _as_kst(now)
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


def normalize_budget(budget: dict, now: datetime) -> dict:
    now = _as_kst(now)
    today = now.date().isoformat()
    pending = budget.get("pending") if isinstance(budget.get("pending"), dict) else {}
    if budget.get("date") != today:
        return {
            "date": today,
            "signals": 0,
            "issues": 0,
            "self_comments": 0,
            "pending": copy.deepcopy(pending),
        }
    return {
        "date": today,
        "signals": int(budget.get("signals", 0)),
        "issues": int(budget.get("issues", 0)),
        "self_comments": int(budget.get("self_comments", 0)),
        "pending": copy.deepcopy(pending),
    }


def valid_outbox_item(item: object) -> bool:
    if not isinstance(item, dict) or not isinstance(item.get("id"), str):
        return False
    try:
        _parse_time(item["created_at"])
        surfaced_at = item.get("surfaced_at")
        if surfaced_at is not None:
            _parse_time(surfaced_at)
    except (KeyError, TypeError, ValueError):
        return False
    return True


def active_outbox(items: list[dict], now: datetime) -> list[dict]:
    now = _as_kst(now)
    active = []
    for item in items:
        if not valid_outbox_item(item):
            continue
        surfaced_at = item.get("surfaced_at")
        if surfaced_at is None or _parse_time(surfaced_at) + timedelta(minutes=OUTBOX_ACTIVE_MINUTES) > now:
            active.append(item)
    return active


def sanitize_note(note: object) -> str:
    text = re.sub(r"[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]+", " ", str(note))
    text = text.replace("<desire_state>", "").replace("</desire_state>", "")
    return text[:300]


def serialize_desire_block(levels: dict[str, float], items: list[dict]) -> str:
    lines = [
        "<desire_state>",
        (
            "drives: "
            f"social {displayed_level(levels['social'])}/100 ({bucket(levels['social'])}) | "
            f"curiosity {displayed_level(levels['curiosity'])}/100 ({bucket(levels['curiosity'])}) | "
            f"accomplishment {displayed_level(levels['accomplishment'])}/100 "
            f"({bucket(levels['accomplishment'])})"
        ),
    ]
    ordered = sorted(items, key=lambda item: (item.get("created_at", ""), item.get("id", "")))
    if ordered:
        lines.append(f"pent-up ({len(ordered)}):")
        for item in ordered:
            timestamp = _parse_time(item["created_at"]).strftime("%Y-%m-%d %H:%M")
            lines.append(f"- [{timestamp}] {sanitize_note(item.get('note', ''))}")
    lines.append("</desire_state>")
    return "\n".join(lines)


def satisfy(drive: str, amount: float, why: str, now: datetime) -> None:
    now = _as_kst(now)
    if drive not in ("curiosity", "accomplishment"):
        raise ValueError(f"drive is not satisfiable: {drive}")
    with state_lock() as state_dir:
        state = bootstrap_locked(state_dir, now)
        drives = state["drives"]
        current = drive_levels(drives, now)[drive]
        drives[drive] = {"level": _clamp(current - float(amount)), "anchor_at": now.isoformat()}
        write_json_atomic(state_dir / "drives.json", drives)
        _append_jsonl_locked(
            state_dir / "audit.jsonl",
            {
                "at": now.isoformat(),
                "event": "drive_satisfied",
                "drive": drive,
                "amount": float(amount),
                "why": why,
            },
        )


def reservation_is_older_than(pending: dict, cutoff: date) -> bool:
    """Return whether a dated reservation predates a monitor cutoff."""

    try:
        return date.fromisoformat(pending["date"]) < cutoff
    except (KeyError, TypeError, ValueError):
        return True
