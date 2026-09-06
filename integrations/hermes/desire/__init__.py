"""Hermes middleware that appends Natsume's current desire state.

The cache is intentionally a single, process-local entry. Interleaved sessions may
evict one another, and byte-identical user text may share an entry; YUI's per-turn
timestamp makes the latter vanishingly unlikely. Neither limitation affects state
correctness, only the prompt-cache byte-stability optimization.
"""

import copy
import hashlib
import logging
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import desire_state

logger = logging.getLogger(__name__)

_VERSION = "0.1.0"
KST = ZoneInfo("Asia/Seoul")
_TEXT_TYPES = ("text", "input_text")
_CLIENT_CONTEXT = re.compile(r"<client_context>\n(?:(?!</?client_context>).)*?</client_context>", re.DOTALL)
_USER_TRIGGER = re.compile(r"^trigger: user message(?: \(user idle \d+min\))?$")
_TRIGGER_LINE = re.compile(r"trigger: (?P<kind>\S+)")
_TRIGGER_KINDS = ("proactive", "screen", "agent", "signals")
_DRIVES_LINE = re.compile(
    r"drives: social (?P<social>0|[1-9]\d?|100)/100 \((?P<social_bucket>low|mid|high)\) \| "
    r"curiosity (?P<curiosity>0|[1-9]\d?|100)/100 \((?P<curiosity_bucket>low|mid|high)\) \| "
    r"accomplishment (?P<accomplishment>0|[1-9]\d?|100)/100 "
    r"\((?P<accomplishment_bucket>low|mid|high)\)"
)
_LAST_INTERACTION_LINE = re.compile(r"last interaction: \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(\d+h ago\)")
_RETURNED_LINE = re.compile(r"returned: after \d+h away(?: \(one held note fits here\))?")
_TRANSPORT_LINE = re.compile(
    r"signal transport: (?:up|unknown|down since \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(\d+ failed\))"
)
_LAST_SIGNAL_LINE = re.compile(
    r"last signal: \d{4}-\d{2}-\d{2} \d{2}:\d{2} — (?:answered after \d+h|no reply yet \(\d+h\))"
)
_PENT_UP_LINE = re.compile(r"pent-up \((?P<count>[1-9]\d*)\):")
_OUTBOX_LINE = re.compile(r"- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] [^\n]*")
_CACHE_TTL = timedelta(minutes=10)
_STATE_FILES = (
    "drives.json",
    "budget.json",
    "cursor.json",
    "monitor.json",
    "outbox.jsonl",
    "audit.jsonl",
    "ticks.jsonl",
)
_turn_cache = None


def register(ctx):
    ctx.register_middleware("llm_request", _inject)


def _texts_of(content):
    """Yield mutable ``(part, key)`` pairs for list-form text carriers."""
    if isinstance(content, list):
        for part in content:
            if (
                isinstance(part, dict)
                and part.get("type") in _TEXT_TYPES
                and isinstance(part.get("text"), str)
            ):
                yield part, "text"


def _message_text(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    return "".join(part[key] for part, key in _texts_of(content))


def _last_text_carrier(message):
    content = message.get("content")
    if isinstance(content, str):
        return message, "content"
    carriers = list(_texts_of(content))
    return carriers[-1] if carriers else None


def _already_injected(text):
    stripped = text.rstrip()
    opening = stripped.rfind("\n<desire_state>\n")
    if opening < 0:
        return False
    lines = stripped[opening + 1 :].split("\n")
    if len(lines) < 5 or lines[0] != "<desire_state>" or lines[-1] != "</desire_state>":
        return False
    drives = _DRIVES_LINE.fullmatch(lines[1])
    if drives is None:
        return False
    for name in ("social", "curiosity", "accomplishment"):
        if desire_state.bucket(int(drives[name])) != drives[f"{name}_bucket"]:
            return False
    if _LAST_INTERACTION_LINE.fullmatch(lines[2]) is None:
        return False
    index = 4 if _RETURNED_LINE.fullmatch(lines[3]) is not None else 3
    if _TRANSPORT_LINE.fullmatch(lines[index]) is None:
        return False
    index += 1
    if _LAST_SIGNAL_LINE.fullmatch(lines[index]) is not None:
        index += 1
    if index == len(lines) - 1:
        return True
    header = _PENT_UP_LINE.fullmatch(lines[index])
    count = int(header["count"]) if header is not None else 0
    return (
        count > 0
        and len(lines) == index + count + 2
        and all(_OUTBOX_LINE.fullmatch(line) is not None for line in lines[index + 1 : -1])
    )


def _trigger_kind(text):
    """Name what fired the turn, from the headline trigger line of the last well-formed block."""
    blocks = list(_CLIENT_CONTEXT.finditer(text))
    if not blocks:
        return "none"
    lines = [line.strip() for line in blocks[-1].group(0).splitlines()]
    if any(_USER_TRIGGER.fullmatch(line) for line in lines):
        return "user message"
    for line in lines:
        headline = _TRIGGER_LINE.match(line)
        if headline is not None:
            return headline["kind"] if headline["kind"] in _TRIGGER_KINDS else "other"
    return "none"


def _build_desire_block(drives, outbox, transport, now, *, returned_hours=None):
    levels = desire_state.drive_levels(drives, now)
    visible = desire_state.visible_outbox(outbox, now)
    block = desire_state.serialize_desire_block(
        levels,
        visible,
        now,
        last_interaction_at=drives["last_interaction_at"],
        transport=transport,
        returned_hours=returned_hours,
        last_signal_at=drives.get("last_signal_at"),
        last_signal_answered_at=drives.get("last_signal_answered_at"),
    )
    return block, tuple(item["id"] for item in visible)


def _returned(transport, last_interaction):
    """Report whether the ingress was unreachable at any point since the last exchange."""
    if transport is None:
        return False
    return transport["state"] == "down" or desire_state.parse_timestamp(transport["since"]) > last_interaction


def _answers_signal(drives):
    """Report whether this turn is the first user message since the last delivered signal."""
    signal_at = drives.get("last_signal_at")
    if not signal_at:
        return False
    answered_at = drives.get("last_signal_answered_at")
    return answered_at is None or desire_state.parse_timestamp(answered_at) < desire_state.parse_timestamp(
        signal_at
    )


def _whole_hours(since, now):
    return int(max(0.0, (now - since).total_seconds()) // 3600)


def _rewrite(kwargs, event):
    global _turn_cache
    request = kwargs["request"]
    now = desire_state.normalize_now(kwargs.get("now") or datetime.now(KST))
    key = "messages" if isinstance(request.get("messages"), list) else "input"
    messages = request.get(key)
    if not isinstance(messages, list):
        event["reason"] = "no-messages"
        return None

    user_index = next(
        (
            index
            for index in range(len(messages) - 1, -1, -1)
            if isinstance(messages[index], dict) and messages[index].get("role") == "user"
        ),
        None,
    )
    if user_index is None or _last_text_carrier(messages[user_index]) is None:
        event["reason"] = "no-user-text"
        return None

    content = messages[user_index].get("content")
    event["shape"] = f"{key}/{'str' if isinstance(content, str) else 'list'}"

    original_text = _message_text(messages[user_index])
    if _already_injected(original_text):
        event["reason"] = "already-injected"
        return None

    state_dir = desire_state.resolve_state_dir()
    text_hash = hashlib.sha256(original_text.encode("utf-8")).hexdigest()
    cache_key = (str(state_dir.resolve()), text_hash)

    initialized = (state_dir / "state.lock").exists() or any(
        (state_dir / name).exists() for name in _STATE_FILES
    )
    if initialized:
        with desire_state.state_lock(state_dir):
            drives = desire_state.read_drives_snapshot(state_dir, now)
            outbox = desire_state.read_jsonl(state_dir / "outbox.jsonl")
            transport = desire_state.read_transport(state_dir)
    else:
        drives = desire_state.default_drives(now)
        outbox = []
        transport = None

    staged_drives = copy.deepcopy(drives)
    trigger = _trigger_kind(original_text)
    event["trigger"] = trigger
    interaction = trigger == "user message" or kwargs.get("platform") == "telegram"
    event["interaction"] = interaction
    interaction_changed = False
    returned_hours = None
    if interaction and drives.get("last_interaction_hash") != text_hash:
        staged_drives["last_interaction_hash"] = text_hash
        last_interaction = desire_state.parse_timestamp(drives["last_interaction_at"])
        interaction_changed = True
        if _returned(transport, last_interaction):
            returned_hours = _whole_hours(last_interaction, now)
        if returned_hours is not None or now - last_interaction > timedelta(minutes=5):
            staged_drives["last_interaction_at"] = now.isoformat()
        if _answers_signal(drives):
            staged_drives["last_signal_answered_at"] = now.isoformat()

    cached = _turn_cache
    cache_hit = cached is not None and cached["key"] == cache_key and now - cached["last_hit"] <= _CACHE_TTL
    event["cache_hit"] = cache_hit
    new_turn = cached is None or cached["key"] != cache_key
    if cache_hit:
        block = cached["block"]
        included_ids = cached["included_ids"]
    else:
        block, included_ids = _build_desire_block(
            staged_drives, outbox, transport, now, returned_hours=returned_hours
        )

    rewritten = copy.deepcopy(request)
    rewritten_messages = rewritten[key]
    carrier, carrier_key = _last_text_carrier(rewritten_messages[user_index])
    carrier[carrier_key] += "\n\n" + block

    with desire_state.state_lock(state_dir):
        committed_state = desire_state.bootstrap_locked(state_dir, now)
        if interaction_changed:
            current_drives = committed_state["drives"]
            if current_drives.get("last_interaction_hash") != text_hash:
                answers = _answers_signal(current_drives)
                current_transport = desire_state.read_transport(state_dir)
                last_interaction = desire_state.parse_timestamp(current_drives["last_interaction_at"])
                returns = returned_hours is not None and _returned(current_transport, last_interaction)
                drives_to_write = copy.deepcopy(current_drives)
                drives_to_write["last_interaction_hash"] = text_hash
                if returns or now - last_interaction > timedelta(minutes=5):
                    drives_to_write["last_interaction_at"] = now.isoformat()
                if answers:
                    drives_to_write["last_signal_answered_at"] = now.isoformat()
                desire_state.write_json_atomic(state_dir / "drives.json", drives_to_write)
                if answers:
                    signal_at = desire_state.parse_timestamp(current_drives["last_signal_at"])
                    desire_state.append_jsonl(
                        state_dir / "audit.jsonl",
                        {
                            "at": now.isoformat(),
                            "event": "signal_answered",
                            "signal_at": current_drives["last_signal_at"],
                            "delay_hours": _whole_hours(signal_at, now),
                        },
                    )
                if returns:
                    if current_transport["state"] == "down":
                        desire_state.record_transport(state_dir, True, now, source="user-turn")
                    desire_state.append_jsonl(
                        state_dir / "audit.jsonl",
                        {
                            "at": now.isoformat(),
                            "event": "returned",
                            "away_hours": _whole_hours(last_interaction, now),
                            "pent_up": len(included_ids),
                            "transport_before": current_transport["state"],
                        },
                    )

        desire_state.stamp_outbox(state_dir / "outbox.jsonl", included_ids, now)

        _turn_cache = {
            "key": cache_key,
            "block": block,
            "included_ids": included_ids,
            "last_hit": now,
        }

        if new_turn:
            try:
                desire_state.append_jsonl(
                    state_dir / "audit.jsonl",
                    {
                        "at": now.isoformat(),
                        "event": "turn",
                        "trigger": trigger,
                        "platform": _safe_id(kwargs.get("platform")) or "none",
                    },
                )
            except Exception:  # noqa: BLE001, S110 - the turn trail must never affect delivery
                pass

    event["outcome"] = "injected"
    return {"request": rewritten, "source": "yui-desire", "reason": "desire-state"}


def _safe_id(value):
    if value is None:
        return None
    return str(value)[:64].replace("\n", " ").replace("\r", " ")


def _log_event(event, kwargs):
    try:
        logger.debug(
            "yui-desire llm_request plugin=yui-desire/%s outcome=%s reason=%s interaction=%s "
            "trigger=%s platform=%s shape=%s cache_hit=%s api_request_id=%s turn_id=%s session_id=%s",
            _VERSION,
            event["outcome"],
            event["reason"],
            event["interaction"],
            event["trigger"],
            _safe_id(kwargs.get("platform")) or "none",
            event["shape"],
            event["cache_hit"],
            _safe_id(kwargs.get("api_request_id")),
            _safe_id(kwargs.get("turn_id")),
            _safe_id(kwargs.get("session_id")),
        )
    except Exception:  # noqa: BLE001, S110 - logging must never affect request delivery
        pass


def _inject(**kwargs):
    """Return a rewritten provider request, or fail open with ``None``."""
    event = {
        "outcome": "skipped",
        "reason": None,
        "interaction": None,
        "trigger": None,
        "shape": None,
        "cache_hit": None,
    }
    try:
        return _rewrite(kwargs, event)
    except Exception as exc:  # noqa: BLE001 - middleware must fail open for every plugin failure
        event["outcome"] = "error"
        event["reason"] = type(exc).__name__
        return None
    finally:
        _log_event(event, kwargs)
