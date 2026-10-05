"""Locked JSON and JSONL files, and the typed readers of the transport and artefact records."""

from __future__ import annotations

import copy
import fcntl
import json
import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

if __package__:
    from . import desire_config
else:
    import desire_config

ARTEFACT_KINDS = ("pr", "issue", "skill")
_lock_guard = threading.RLock()
_lock_local = threading.local()


@contextmanager
def state_lock(state_dir: Path | None = None) -> Iterator[Path]:
    """Hold the process-wide and filesystem lock for one state transaction.

    The context is re-entrant for helpers called during a larger transaction.
    """

    directory = Path(state_dir) if state_dir is not None else desire_config.resolve_state_dir()
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


def read_transport(state_dir: Path) -> dict | None:
    """Return the recorded signal transport state, or ``None`` when absent or unreadable."""

    try:
        value = json.loads((Path(state_dir) / "transport.json").read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("state") not in ("up", "down"):
            return None
        desire_config.parse_timestamp(value["since"])
        return {**value, "failed": int(value.get("failed", 0))}
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError, UnicodeError, OSError, ValueError):
        return None


def record_transport(state_dir: Path, reachable: bool, now: datetime, *, source: str = "probe") -> dict:
    """Record one delivery or probe outcome; ``since`` marks the start of the current state.

    An outcome older than the recorded ``last_checked_at`` is discarded. An unreadable
    ``transport.json`` is quarantined like the other state files before the rebuild.
    """

    now = desire_config.normalize_now(now)
    state_dir = Path(state_dir)
    path = state_dir / "transport.json"
    with state_lock(state_dir):
        previous = read_transport(state_dir)
        if previous is None and path.exists():
            _recover_invalid_json_locked(path, None, now)
            path.unlink(missing_ok=True)
        if previous is not None:
            try:
                if desire_config.parse_timestamp(previous["last_checked_at"]) > now:
                    return previous
            except (KeyError, TypeError, ValueError):
                pass
        state = "up" if reachable else "down"
        unchanged = previous is not None and previous["state"] == state
        value = {
            "state": state,
            "since": previous["since"] if unchanged else now.isoformat(),
            "failed": 0 if reachable else (previous["failed"] if previous else 0) + 1,
            "last_checked_at": now.isoformat(),
            "source": source,
        }
        write_json_atomic(path, value)
        return value


def default_artefacts(now: datetime) -> dict:
    """Return an empty record: no source has answered yet, so nothing is scored from it."""

    stamp = desire_config.normalize_now(now).isoformat()
    return {
        "bootstrapped_at": stamp,
        "bootstrapped": [],
        "seen": {kind: [] for kind in ARTEFACT_KINDS},
        "skill_first_seen": {},
        "shipped": [],
        "learned": [],
        "unreported": [],
    }


def read_artefacts(state_dir: Path) -> dict | None:
    """Return the derived-artefact record, or ``None`` when it is absent or unreadable."""

    try:
        value = json.loads((Path(state_dir) / "artefacts.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeError, OSError):
        return None
    if not isinstance(value, dict):
        return None
    seen = value.get("seen") if isinstance(value.get("seen"), dict) else {}
    return {
        "bootstrapped_at": value.get("bootstrapped_at"),
        "bootstrapped": [kind for kind in _text_list(value.get("bootstrapped")) if kind in ARTEFACT_KINDS],
        "seen": {kind: _text_list(seen.get(kind)) for kind in ARTEFACT_KINDS},
        "skill_first_seen": _text_map(value.get("skill_first_seen")),
        "shipped": _text_list(value.get("shipped")),
        "learned": _text_list(value.get("learned")),
        "unreported": [item for item in _list(value.get("unreported")) if isinstance(item, dict)],
    }


def _list(value: object) -> list:
    return value if isinstance(value, list) else []


def _text_list(value: object) -> list[str]:
    return [item for item in _list(value) if isinstance(item, str)]


def _text_map(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


def load_json(path: Path, default: object, now: datetime) -> object:
    """Load a JSON state file, quarantining and replacing corrupt content."""

    now = desire_config.normalize_now(now)
    path = Path(path)
    with state_lock(path.parent):
        if not path.exists():
            value = default() if callable(default) else copy.deepcopy(default)
            write_json_atomic(path, value)
            return value
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeError, OSError):
            return _recover_invalid_json_locked(path, default, now)


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
