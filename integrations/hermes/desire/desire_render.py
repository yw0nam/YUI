"""Deterministic serialization of the desire block."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from itertools import groupby

if __package__:
    from . import desire_config, desire_events, desire_judgments
else:
    import desire_config
    import desire_events
    import desire_judgments


RECENT_LIMIT = 3
EVENTS_POINTER = "to record how you took something: act.py feel --help"


def sanitize_note(note: object, limit: int = 300) -> str:
    text = re.sub(r"[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]+", " ", str(note))
    stripped = None
    while stripped != text:
        stripped, text = text, text.replace("<desire_state>", "").replace("</desire_state>", "")
    return text[:limit]


def _transport_line(transport: dict | None) -> str:
    if transport is None:
        return "signal transport: unknown"
    if transport["state"] == "up":
        return "signal transport: up"
    since = desire_config.parse_timestamp(transport["since"]).strftime("%Y-%m-%d %H:%M")
    return f"signal transport: down since {since} ({transport['failed']} failed)"


def _last_signal_line(last_signal_at: str, last_signal_answered_at: str | None, now: datetime) -> str:
    sent = desire_config.parse_timestamp(last_signal_at)
    stamp = sent.strftime("%Y-%m-%d %H:%M")
    answered = desire_config.parse_timestamp(last_signal_answered_at) if last_signal_answered_at else None
    if answered is not None and answered >= sent:
        delay = int((answered - sent).total_seconds() // 3600)
        return f"last signal: {stamp} — answered after {delay}h"
    waited = int(max(0.0, (now - sent).total_seconds()) // 3600)
    return f"last signal: {stamp} — no reply yet ({waited}h)"


def _quoted(text: object) -> str:
    return '"' + sanitize_note(text).replace('"', "'") + '"'


def _event_lines(events: Sequence[dict], unread: int) -> list[str]:
    """Render the most recent events, the unread count, and the helper pointer when either shows."""

    lines = []
    recent = desire_events.chronological(events)[-RECENT_LIMIT:]
    if recent:
        lines.append("recent:")
    for event in recent:
        day = desire_config.parse_timestamp(event["at"]).strftime("%m-%d")
        reading = f" — {_quoted(event['reading']['text'])}" if event["reading"] else ""
        lines.append(f"- {day} {_quoted(event['fact'])}{reading}")
    if unread:
        lines.append(f"waiting for my reading: {unread} {'event' if unread == 1 else 'events'}")
    if lines:
        lines.append(EVENTS_POINTER)
    return lines


def _judgment(name: str, held: dict) -> str:
    day = desire_config.parse_timestamp(held["at"]).strftime("%m-%d")
    return f"{sanitize_note(name)} {held['level']} ({day})"


def _judgment_lines(judgments: Mapping[tuple[str, str], dict], how: str) -> list[str]:
    """Render one line per toward that holds a judgment, then the how-I-am line when it has text."""

    lines = []
    for toward, group in groupby(desire_judgments.ordered(judgments), key=lambda item: item[0][1]):
        shown = " | ".join(_judgment(name, held) for (name, _), held in group)
        lines.append(f"toward {toward}: {shown}")
    how = sanitize_note(how, limit=desire_judgments.HOW_LIMIT)
    if how.strip():
        lines.append(f"how I am: {how}")
    return lines


def serialize_desire_block(
    items: list[dict],
    now: datetime,
    *,
    last_interaction_at: str,
    transport: dict | None = None,
    returned_hours: int | None = None,
    last_signal_at: str | None = None,
    last_signal_answered_at: str | None = None,
    events: Sequence[dict] = (),
    unread: int = 0,
    judgments: Mapping[tuple[str, str], dict] | None = None,
    how: str = "",
) -> str:
    now = desire_config.normalize_now(now)
    last_interaction = desire_config.parse_timestamp(last_interaction_at)
    since_interaction = int(max(0.0, (now - last_interaction).total_seconds()) // 3600)
    lines = [
        "<desire_state>",
        f"agent: {desire_config.agent_name()}",
        *_judgment_lines(judgments or {}, how),
        *_event_lines(events, unread),
        f"last interaction: {last_interaction.strftime('%Y-%m-%d %H:%M')} ({since_interaction}h ago)",
    ]
    if returned_hours is not None:
        held = " (one held note fits here)" if items else ""
        lines.append(f"returned: after {returned_hours}h away{held}")
    lines.append(_transport_line(transport))
    if last_signal_at:
        lines.append(_last_signal_line(last_signal_at, last_signal_answered_at, now))
    ordered = sorted(items, key=lambda item: (item.get("created_at", ""), item.get("id", "")))
    if ordered:
        lines.append(f"pent-up ({len(ordered)}):")
        for item in ordered:
            created_at = desire_config.parse_timestamp(item["created_at"])
            timestamp = created_at.strftime("%Y-%m-%d %H:%M")
            attempts = item.get("attempts")
            suffix = f" (attempts {attempts})" if isinstance(attempts, int) and attempts >= 2 else ""
            lines.append(f"- [{timestamp}] {sanitize_note(item.get('note', ''))}{suffix}")
    lines.append("</desire_state>")
    return "\n".join(lines)
