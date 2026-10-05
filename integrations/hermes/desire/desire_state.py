"""Bootstrap of the state files, the daily budget, and the satisfy transition."""

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
LEARNED_MEMORY = 500
EVENT_DAILY_CAPS = {"learned": 6, "progressed": 6, "shipped": 4, "praised": 4}


def _default_budget(now: datetime) -> dict:
    return {
        "date": now.date().isoformat(),
        "signals": 0,
        "issues": 0,
        "self_comments": 0,
        "prs": 0,
        "events": {},
        "pending": {},
    }


def _default_cursor(now: datetime) -> dict:
    return {"last_feedback_check_at": now.isoformat()}


def _validate_budget(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("pending"), dict):
        raise TypeError("budget state must be an object")
    date.fromisoformat(value["date"])
    for key in ("signals", "issues", "self_comments", "prs"):
        if not isinstance(value.get(key), int):
            raise TypeError("budget counters must be integers")
    events = value.get("events", {})
    if not isinstance(events, dict) or any(
        not isinstance(event, str) or not isinstance(count, int) for event, count in events.items()
    ):
        events = {}
    return {**value, "events": copy.deepcopy(events)}


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
    # monitor.json comes last: its default latches the buckets of the drives loaded above.
    definitions = (
        ("drives.json", lambda: desire_drives._default_drives(now), desire_drives._normalize_drives),
        ("budget.json", lambda: _default_budget(now), _validate_budget),
        ("cursor.json", lambda: _default_cursor(now), _normalize_cursor),
        (
            "monitor.json",
            lambda: desire_drives._default_monitor(loaded["drives"], now),
            desire_drives._normalize_monitor,
        ),
    )
    for filename, default, normalizer in definitions:
        path = state_dir / filename
        value = desire_store.load_json(path, default, now)
        try:
            normalized = normalizer(value)
        except (KeyError, TypeError, ValueError):
            normalized = desire_store._recover_invalid_json_locked(path, default, now)
        if normalized != value:
            desire_store.write_json_atomic(path, normalized)
        loaded[filename.removesuffix(".json")] = normalized
    for name in ("outbox.jsonl", "audit.jsonl", "ticks.jsonl"):
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
            "events": {},
            "pending": copy.deepcopy(pending),
        }
    events = budget.get("events") if isinstance(budget.get("events"), dict) else {}
    return {
        "date": budget["date"],
        "signals": int(budget.get("signals", 0)),
        "issues": int(budget.get("issues", 0)),
        "self_comments": int(budget.get("self_comments", 0)),
        "prs": int(budget.get("prs", 0)),
        "events": {str(event): max(0, int(count)) for event, count in events.items()},
        "pending": copy.deepcopy(pending),
    }


def satisfy(
    event: str, ref: str, now: datetime, *, kind: str | None = None, state_dir: Path | None = None
) -> float:
    now = desire_config.normalize_now(now)
    if event not in desire_drives.EVENT_DOSES:
        raise ValueError(f"unknown event: {event}")
    named = {"ref": ref} if kind is None else {"ref": ref, "kind": kind}
    with desire_store.state_lock(state_dir) as directory:
        state = bootstrap_locked(directory, now)
        # `learned` names a source the agent read, so one source owes one dose for good.
        artefacts = (
            (desire_store.read_artefacts(directory) or desire_store.default_artefacts(now))
            if event == "learned"
            else None
        )
        if artefacts is not None and ref in artefacts["learned"]:
            desire_store._append_jsonl_locked(
                directory / "audit.jsonl",
                {"at": now.isoformat(), "event": "satisfy_repeated", "event_type": event, **named},
            )
            raise ValueError(f"already reported: {ref}")

        budget = normalize_budget(state["budget"], now)
        count = budget["events"].get(event, 0)
        cap = EVENT_DAILY_CAPS[event]
        if count >= cap:
            desire_store._append_jsonl_locked(
                directory / "audit.jsonl",
                {"at": now.isoformat(), "event": "satisfy_blocked", "event_type": event, **named},
            )
            raise ValueError(f"over budget: {event} daily cap is {cap}")

        drives = state["drives"]
        before = desire_drives.drive_levels(drives, now)
        after = copy.deepcopy(before)
        doses = dict(desire_drives.EVENT_DOSES[event])
        for drive, dose in doses.items():
            after[drive] = desire_drives._clamp(before[drive] - dose)
            drives[drive] = {"level": after[drive], "anchor_at": now.isoformat()}
        reward = desire_drives.homeostatic_drive(before) - desire_drives.homeostatic_drive(after)

        budget["events"][event] = count + 1
        # Budget and the reported source commit before drives: a crash after this point costs one
        # unused daily slot, rather than an uncounted dose that could be applied again.
        desire_store.write_json_atomic(directory / "budget.json", budget)
        if artefacts is not None:
            artefacts["learned"] = [*artefacts["learned"], ref][-LEARNED_MEMORY:]
            desire_store.write_json_atomic(directory / "artefacts.json", artefacts)
        desire_store.write_json_atomic(directory / "drives.json", drives)
        desire_store._append_jsonl_locked(
            directory / "audit.jsonl",
            {
                "at": now.isoformat(),
                "event": "drive_satisfied",
                "event_type": event,
                "doses": doses,
                "reward": round(reward, 4),
                **named,
            },
        )
        return reward


def reservation_is_older_than(pending: dict, cutoff: date) -> bool:
    """Return whether a dated reservation predates a monitor cutoff."""

    try:
        return date.fromisoformat(pending["date"]) < cutoff
    except (KeyError, TypeError, ValueError):
        return True
