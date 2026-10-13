"""The feelings registry, the judgments log and its present state, and the agent's how-I-am text."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path

if __package__:
    from . import desire_config, desire_events, desire_store
else:
    import desire_config
    import desire_events
    import desire_store

LEVELS = ("faint", "some", "strong", "very strong")
TOWARDS = ("user", "self", "world")
SEED_NAMES = (
    "closeness",
    "trust",
    "doubt",
    "longing",
    "ease",
    "expectation",
    "hope",
    "curiosity",
    "absorption",
    "traction",
    "pride",
    "sense of choosing",
    "surprise",
    "amusement",
    "loneliness",
    "hurt",
    "disappointment",
    "frustration",
    "wavering",
    "tiredness",
    "wariness",
    "anger",
    "jealousy",
    "resentment",
    "contempt",
    "shame",
)
HOW_LIMIT = 500


def default_registry() -> dict:
    return {"names": list(SEED_NAMES)}


def normalize_registry(value: object) -> dict:
    """Return a valid registry as it was read, so a hand-edited file is never rewritten."""

    if not isinstance(value, dict) or not isinstance(value.get("names"), list):
        raise TypeError("feelings registry must be an object with a names list")
    names = value["names"]
    if not all(isinstance(name, str) and name for name in names) or len(set(names)) != len(names):
        raise ValueError("feeling names must be non-empty distinct text")
    return value


def registry(state_dir: Path) -> list[str]:
    """Return the registered names; the seed names stand in until the bootstrap writes a valid file."""

    try:
        value = json.loads((Path(state_dir) / "feelings.json").read_text(encoding="utf-8"))
        return normalize_registry(value)["names"]
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        return list(SEED_NAMES)


def _valid(line: dict) -> bool:
    try:
        desire_config.parse_timestamp(line["at"])
    except (KeyError, TypeError, ValueError):
        return False
    level, events, why = line.get("level"), line.get("events"), line.get("why")
    return (
        isinstance(line.get("name"), str)
        and bool(line["name"])
        and line.get("toward") in TOWARDS
        and (level is None or level in LEVELS)
        and isinstance(events, list)
        and all(isinstance(event_id, str) for event_id in events)
        and (level is not None or not events)
        and (why is None or isinstance(why, str))
    )


def _latest(state_dir: Path) -> dict[tuple[str, str], dict]:
    """Return the latest valid line per ``(name, toward)`` in file order, put-downs included."""

    latest: dict[tuple[str, str], dict] = {}
    for line in desire_store.read_jsonl(Path(state_dir) / "judgments.jsonl"):
        if _valid(line):
            latest[(line["name"], line["toward"])] = line
    return latest


def present(state_dir: Path) -> dict[tuple[str, str], dict]:
    """Return every held judgment by ``(name, toward)``."""

    return {
        pair: {key: line[key] for key in ("level", "at", "events", "why")}
        for pair, line in _latest(state_dir).items()
        if line["level"] is not None
    }


def ordered(held: Mapping[tuple[str, str], dict]) -> list[tuple[tuple[str, str], dict]]:
    """Return the judgments by toward in the order of ``TOWARDS``, then by name."""

    return sorted(held.items(), key=lambda item: (TOWARDS.index(item[0][1]), item[0][0]))


def grounds(state_dir: Path, name: str, toward: str) -> list[dict]:
    """Return the shown events the present judgment links, in file order."""

    held = present(state_dir).get((name, toward))
    if held is None:
        return []
    return [event for event in desire_events.events_view(state_dir) if event["id"] in held["events"]]


def judge(
    state_dir: Path,
    name: str,
    toward: str,
    level: str | None,
    events: Sequence[str],
    why: str | None,
    now: datetime,
) -> None:
    """Append one judgment, or a put-down when ``level`` is ``None``."""

    name = name.strip()
    events = list(events)
    if why is not None:
        why = why.strip() or None
    if toward not in TOWARDS:
        raise ValueError(f"unknown toward {toward!r}")
    if level is not None and level not in LEVELS:
        raise ValueError(f"unknown level {level!r}")
    if level is None and events:
        raise ValueError("a put-down links no events")
    stamp = desire_config.normalize_now(now).isoformat()
    with desire_store.state_lock(state_dir):
        if level is None:
            if (name, toward) not in present(state_dir):
                raise ValueError("no judgment to put down")
        else:
            names = registry(state_dir)
            if name not in names:
                raise ValueError(f"unknown name {name}\nknown names:\n" + "\n".join(names))
        for event_id in events:
            desire_events.require_live(state_dir, event_id)
        desire_store.append_jsonl(
            Path(state_dir) / "judgments.jsonl",
            {"at": stamp, "name": name, "toward": toward, "level": level, "events": events, "why": why},
        )


def read_how(state_dir: Path) -> str:
    try:
        return (Path(state_dir) / "how.md").read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return ""


def write_how(state_dir: Path, text: str) -> None:
    text = text.strip()
    if len(text) > HOW_LIMIT:
        raise ValueError(f"too long: {len(text)} characters (limit {HOW_LIMIT})")
    path = Path(state_dir) / "how.md"
    with desire_store.state_lock(state_dir):
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text(text, encoding="utf-8")
        os.replace(temporary, path)
