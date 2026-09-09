"""Count how often Natsume's own skills are loaded, for the daily report section."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import desire_state

WINDOW = timedelta(days=7)
UNUSED_AFTER = timedelta(days=14)
SQLITE_TIMEOUT = 2
TICK_JOB = "natsume-desire-tick"
VIEW_TOOL = "skill_view"
HEADER = "skills you made (7 days):"
EMPTY = f"{HEADER} none yet"
UNUSED = " — unused: archive it or say why it stays"


def _tick_prefix(profile: Path) -> str:
    """Return the session-id prefix Hermes gives every run of the desire tick job."""

    payload = json.loads((profile / "cron" / "jobs.json").read_text(encoding="utf-8"))
    jobs = payload.get("jobs") if isinstance(payload, dict) else payload
    for job in jobs if isinstance(jobs, list) else []:
        if isinstance(job, dict) and job.get("name") == TICK_JOB and isinstance(job.get("id"), str):
            return f"cron_{job['id']}_"
    raise LookupError(f"cron/jobs.json names no {TICK_JOB} job")


def _viewed(payload: object) -> list[str]:
    """Name every skill one assistant turn loaded."""

    try:
        calls = json.loads(payload)
    except (TypeError, ValueError):
        return []
    names = []
    for call in calls if isinstance(calls, list) else []:
        function = call.get("function") if isinstance(call, dict) else None
        if not isinstance(function, dict) or function.get("name") != VIEW_TOOL:
            continue
        try:
            arguments = json.loads(function.get("arguments") or "{}")
        except (TypeError, ValueError):
            continue
        name = arguments.get("name") if isinstance(arguments, dict) else None
        if isinstance(name, str) and name:
            names.append(name)
    return names


def _loads(profile: Path, since: datetime) -> dict[str, dict[str, int]]:
    """Count the `skill_view` calls since `since`, by loaded name and session kind."""

    prefix = _tick_prefix(profile)
    uri = f"{(profile / 'state.db').as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=SQLITE_TIMEOUT)
    try:
        rows = connection.execute(
            "SELECT session_id, tool_calls FROM messages "
            "WHERE role = 'assistant' AND tool_calls LIKE ? AND timestamp >= ?",
            (f"%{VIEW_TOOL}%", since.timestamp()),
        ).fetchall()
    finally:
        connection.close()
    counts: dict[str, dict[str, int]] = {}
    for session_id, payload in rows:
        kind = "tick" if str(session_id).startswith(prefix) else "other"
        for name in _viewed(payload):
            counts.setdefault(name, {"tick": 0, "other": 0})[kind] += 1
    return counts


def _usage(profile: Path) -> dict[str, dict]:
    """Return the skill usage records, keyed by skill name without its category prefix."""

    try:
        value = json.loads((profile / "skills" / ".usage.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return {}
    if not isinstance(value, dict):
        return {}
    return {name: entry for name, entry in value.items() if isinstance(entry, dict)}


def _stamp(value: object) -> str:
    if not isinstance(value, str):
        return "never"
    try:
        return desire_state.parse_timestamp(value).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return "never"


def _older_than(value: object, age: timedelta, now: datetime) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return now - desire_state.parse_timestamp(value) >= age
    except ValueError:
        return False


def _line(
    ref: str, entry: dict, counts: dict[str, dict[str, int]] | None, first_seen: str, now: datetime
) -> str:
    last_used = f"last used {_stamp(entry.get('last_used_at'))}"
    if counts is None:
        return f"- {ref} — loads unavailable, {last_used}"
    loaded = {"tick": 0, "other": 0}
    for name in {ref, ref.rsplit("/", 1)[-1]}:
        for kind, count in counts.get(name, {}).items():
            loaded[kind] += count
    line = f"- {ref} — tick {loaded['tick']}, other {loaded['other']}, {last_used}"
    created_at = entry.get("created_at") if isinstance(entry.get("created_at"), str) else first_seen
    if not loaded["other"] and _older_than(created_at, UNUSED_AFTER, now):
        line += UNUSED
    return line


def section(
    now: datetime, *, first_seen: dict[str, str], profile: Path | None = None
) -> tuple[str, str | None]:
    """Render the report section for the skills Natsume made, and why loads went uncounted."""

    now = desire_state.normalize_now(now)
    profile = Path(profile) if profile is not None else desire_state.profile_root()
    usage = _usage(profile)
    made = [
        (ref, usage.get(ref.rsplit("/", 1)[-1], usage.get(ref, {})))
        for ref in sorted(first_seen)
        if (profile / "skills" / ref / "SKILL.md").is_file()
    ]
    made = [(ref, entry) for ref, entry in made if entry.get("state", "active") == "active"]
    if not made:
        return EMPTY, None
    try:
        counts, failure = _loads(profile, now - WINDOW), None
    except Exception as error:  # noqa: BLE001 - an unreadable database degrades this section only
        counts, failure = None, f"{type(error).__name__}: {error}".replace("\n", " ")[:200]
    lines = [_line(ref, entry, counts, first_seen[ref], now) for ref, entry in made]
    return "\n".join([HEADER, *lines]), failure
