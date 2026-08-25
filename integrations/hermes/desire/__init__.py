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
_DRIVES_LINE = re.compile(
    r"drives: social (?P<social>0|[1-9]\d?|100)/100 \((?P<social_bucket>low|mid|high)\) \| "
    r"curiosity (?P<curiosity>0|[1-9]\d?|100)/100 \((?P<curiosity_bucket>low|mid|high)\) \| "
    r"accomplishment (?P<accomplishment>0|[1-9]\d?|100)/100 "
    r"\((?P<accomplishment_bucket>low|mid|high)\)"
)
_PENT_UP_LINE = re.compile(r"pent-up \((?P<count>[1-9]\d*)\):")
_OUTBOX_LINE = re.compile(
    r"- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] "
    r"(?:\(waited \d+d, (?:heavy|bursting)\) )?[^\n]*"
)
_CACHE_TTL = timedelta(minutes=10)
_STATE_FILES = ("drives.json", "budget.json", "cursor.json", "outbox.jsonl", "audit.jsonl")
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
    if len(lines) < 3 or lines[0] != "<desire_state>" or lines[-1] != "</desire_state>":
        return False
    drives = _DRIVES_LINE.fullmatch(lines[1])
    if drives is None:
        return False
    for name in ("social", "curiosity", "accomplishment"):
        if desire_state.bucket(int(drives[name])) != drives[f"{name}_bucket"]:
            return False
    if len(lines) == 3:
        return True
    header = _PENT_UP_LINE.fullmatch(lines[2])
    count = int(header["count"]) if header is not None else 0
    return (
        count > 0
        and len(lines) == count + 4
        and all(_OUTBOX_LINE.fullmatch(line) is not None for line in lines[3:-1])
    )


def _is_interaction(text):
    blocks = list(_CLIENT_CONTEXT.finditer(text))
    if not blocks:
        return False
    body = blocks[-1].group(0)
    return any(_USER_TRIGGER.fullmatch(line.strip()) for line in body.splitlines())


def _build_desire_block(drives, outbox, now):
    levels = desire_state.drive_levels(drives, now)
    active = desire_state.active_outbox(outbox, now)
    return desire_state.serialize_desire_block(levels, active, now), tuple(item["id"] for item in active)


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
    else:
        drives = desire_state.default_drives(now)
        outbox = []

    staged_drives = copy.deepcopy(drives)
    interaction = _is_interaction(original_text)
    event["interaction"] = interaction
    interaction_changed = False
    if interaction and drives.get("last_interaction_hash") != text_hash:
        staged_drives["last_interaction_hash"] = text_hash
        last_interaction = desire_state.parse_timestamp(drives["last_interaction_at"])
        if now - last_interaction > timedelta(minutes=5):
            staged_drives["last_interaction_at"] = now.astimezone(KST).isoformat()
        interaction_changed = True

    cached = _turn_cache
    cache_hit = cached is not None and cached["key"] == cache_key and now - cached["last_hit"] <= _CACHE_TTL
    event["cache_hit"] = cache_hit
    if cache_hit:
        block = cached["block"]
        included_ids = cached["included_ids"]
    else:
        block, included_ids = _build_desire_block(staged_drives, outbox, now)

    rewritten = copy.deepcopy(request)
    rewritten_messages = rewritten[key]
    carrier, carrier_key = _last_text_carrier(rewritten_messages[user_index])
    carrier[carrier_key] += "\n\n" + block

    with desire_state.state_lock(state_dir):
        committed_state = desire_state.bootstrap_locked(state_dir, now)
        if interaction_changed:
            current_drives = committed_state["drives"]
            if current_drives.get("last_interaction_hash") != text_hash:
                drives_to_write = copy.deepcopy(current_drives)
                drives_to_write["last_interaction_hash"] = text_hash
                last_interaction = desire_state.parse_timestamp(current_drives["last_interaction_at"])
                if now - last_interaction > timedelta(minutes=5):
                    drives_to_write["last_interaction_at"] = now.isoformat()
                desire_state.write_json_atomic(state_dir / "drives.json", drives_to_write)

        desire_state.stamp_outbox(state_dir / "outbox.jsonl", included_ids, now)

        _turn_cache = {
            "key": cache_key,
            "block": block,
            "included_ids": included_ids,
            "last_hit": now,
        }

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
            "shape=%s cache_hit=%s api_request_id=%s turn_id=%s session_id=%s",
            _VERSION,
            event["outcome"],
            event["reason"],
            event["interaction"],
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
    event = {"outcome": "skipped", "reason": None, "interaction": None, "shape": None, "cache_hit": None}
    try:
        return _rewrite(kwargs, event)
    except Exception as exc:  # noqa: BLE001 - middleware must fail open for every plugin failure
        event["outcome"] = "error"
        event["reason"] = type(exc).__name__
        return None
    finally:
        _log_event(event, kwargs)
