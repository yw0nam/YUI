"""Deterministic serialization of the desire block."""

from __future__ import annotations

import re
from datetime import datetime

if __package__:
    from . import desire_config, desire_drives, desire_outbox, desire_store
else:
    import desire_config
    import desire_drives
    import desire_outbox
    import desire_store

SINCE_LAST_TURN_LIMIT = 8
_FORGED_MARKER_PREFIX = re.compile(r"^\(waited \d+h, (?:heavy|bursting)\)\s*")


def sanitize_note(note: object) -> str:
    text = re.sub(r"[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]+", " ", str(note))
    text = text.replace("<desire_state>", "").replace("</desire_state>", "")
    while True:
        stripped = _FORGED_MARKER_PREFIX.sub("", text)
        if stripped == text:
            break
        text = stripped
    return text[:300]


def _transport_line(transport: dict | None) -> str:
    if transport is None:
        return "signal transport: unknown"
    if transport["state"] == "up":
        return "signal transport: up"
    since = desire_config.parse_timestamp(transport["since"]).strftime("%Y-%m-%d %H:%M")
    return f"signal transport: down since {since} ({transport['failed']} failed)"


def _since_last_turn_line(unreported: list[dict]) -> str | None:
    """Name the artefacts the monitor scored since the last rendered turn."""

    parts = []
    dropped = 0
    for item in unreported:
        event, kind, ref = item.get("event"), item.get("kind"), item.get("ref")
        if (
            event not in desire_drives.EVENT_DOSES
            or kind not in desire_store.ARTEFACT_KINDS
            or not isinstance(ref, str)
        ):
            continue
        if len(parts) < SINCE_LAST_TURN_LIMIT:
            parts.append(f"{event} {kind} {sanitize_note(ref)}")
        else:
            dropped += 1
    if dropped:
        parts.append(f"and {dropped} more")
    return f"since last turn: {'; '.join(parts)}" if parts else None


def _last_signal_line(last_signal_at: str, last_signal_answered_at: str | None, now: datetime) -> str:
    sent = desire_config.parse_timestamp(last_signal_at)
    stamp = sent.strftime("%Y-%m-%d %H:%M")
    answered = desire_config.parse_timestamp(last_signal_answered_at) if last_signal_answered_at else None
    if answered is not None and answered >= sent:
        delay = int((answered - sent).total_seconds() // 3600)
        return f"last signal: {stamp} — answered after {delay}h"
    waited = int(max(0.0, (now - sent).total_seconds()) // 3600)
    return f"last signal: {stamp} — no reply yet ({waited}h)"


def serialize_desire_block(
    levels: dict[str, float],
    items: list[dict],
    now: datetime,
    *,
    last_interaction_at: str,
    transport: dict | None = None,
    returned_hours: int | None = None,
    last_signal_at: str | None = None,
    last_signal_answered_at: str | None = None,
    unreported: list[dict] | None = None,
) -> str:
    now = desire_config.normalize_now(now)
    last_interaction = desire_config.parse_timestamp(last_interaction_at)
    since_interaction = int(max(0.0, (now - last_interaction).total_seconds()) // 3600)
    lines = [
        "<desire_state>",
        f"agent: {desire_config.agent_name()}",
        (
            "drives: "
            f"social {desire_drives.displayed_level(levels['social'])}/100 ({desire_drives.bucket(levels['social'])}) | "
            f"curiosity {desire_drives.displayed_level(levels['curiosity'])}/100 ({desire_drives.bucket(levels['curiosity'])}) | "
            f"accomplishment {desire_drives.displayed_level(levels['accomplishment'])}/100 "
            f"({desire_drives.bucket(levels['accomplishment'])})"
        ),
        f"last interaction: {last_interaction.strftime('%Y-%m-%d %H:%M')} ({since_interaction}h ago)",
    ]
    if returned_hours is not None:
        held = " (one held note fits here)" if items else ""
        lines.append(f"returned: after {returned_hours}h away{held}")
    lines.append(_transport_line(transport))
    scored = _since_last_turn_line(unreported or [])
    if scored is not None:
        lines.append(scored)
    if last_signal_at:
        lines.append(_last_signal_line(last_signal_at, last_signal_answered_at, now))
    ordered = sorted(items, key=lambda item: (item.get("created_at", ""), item.get("id", "")))
    if ordered:
        lines.append(f"pent-up ({len(ordered)}):")
        for item in ordered:
            created_at = desire_config.parse_timestamp(item["created_at"])
            timestamp = created_at.strftime("%Y-%m-%d %H:%M")
            waited_hours = int((now - created_at).total_seconds() // 3600)
            stage = desire_outbox.pent_up_stage(created_at, now)
            marker = "" if stage == "fresh" else f"(waited {waited_hours}h, {stage}) "
            attempts = item.get("attempts")
            suffix = f" (attempts {attempts})" if isinstance(attempts, int) and attempts >= 2 else ""
            lines.append(f"- [{timestamp}] {marker}{sanitize_note(item.get('note', ''))}{suffix}")
    lines.append("</desire_state>")
    return "\n".join(lines)
