"""The ``generate_express`` tool: the cue contract, declared to the model with YUI's vocabulary.

The tool list the model sees is memoized per registry generation, so an updated vocabulary reaches
the model by registering the tool again — the registry bumps its generation and the memo drops.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import state
from .gate import Vocabulary, cue_of, validate_cue

logger = logging.getLogger(__name__)

TOOLSET = "yui"
TOOL_NAME = "generate_express"

_ctx: Any = None
_declared: str = ""


def set_context(ctx: Any) -> None:
    global _ctx
    _ctx = ctx


def _description(vocab: Vocabulary) -> str:
    channels = (
        "facial expression, body motion, and voice tone"
        if vocab.motion_ids
        else "facial expression and voice tone"
    )
    return (
        f"Place an expression cue on the speech around this call: {channels}. Call it per sentence "
        "or expressive beat, at the point where the expression should change, and include only the "
        "fields that change. Spoken words never go in the arguments."
    )


def _emotion_text_schema(vocab: Vocabulary) -> dict:
    if vocab.emotion_text_mode != "enum" or not vocab.emotion_text_map:
        return {"type": "string", "description": "voice tone tag"}
    meanings = "; ".join(f"{tag} = {meaning}" for tag, meaning in vocab.emotion_text_map.items())
    return {
        "type": "string",
        "description": f"voice tone tag — {meanings}",
        "enum": list(vocab.emotion_text_map),
    }


def build_schema(vocab: Vocabulary) -> dict:
    """The JSON schema the model reads, carrying the ids YUI says it can render."""
    properties: dict[str, Any] = {
        "emotion_id": {
            "type": "string",
            "description": "facial expression",
            "enum": list(vocab.emotion_ids),
        }
    }
    if vocab.motion_ids:
        properties["motion_id"] = {
            "type": "string",
            "description": "body motion",
            "enum": list(vocab.motion_ids),
        }
    properties["emotion_text"] = _emotion_text_schema(vocab)
    properties["caption"] = {
        "type": "string",
        "description": (
            "voice direction in natural language (Japanese reads best), applied to the speech "
            "around this call — independent of emotion_text, and omitted when the default voice fits"
        ),
    }
    return {
        "name": TOOL_NAME,
        "description": _description(vocab),
        "parameters": {"type": "object", "properties": properties, "additionalProperties": False},
    }


def _chat_id() -> str:
    from gateway.session_context import get_session_env

    return str(get_session_env("HERMES_SESSION_CHAT_ID") or "") or "yui"


def handler(args: dict, **_kwargs: Any) -> str:
    """Gate the cue against the chat's last published vocabulary and buffer it for this turn."""
    chat_id = _chat_id()
    vocab = state.vocabulary(chat_id)
    result = validate_cue(args if isinstance(args, dict) else {}, vocab)
    cue = cue_of(result["applied"])
    state.append_cue(chat_id, cue)
    if result["warnings"]:
        logger.warning("yui: generate_express dropped input chat=%s %s", chat_id, result["warnings"])
    logger.info("yui: generate_express chat=%s cue=%s", chat_id, cue)
    return json.dumps(result, ensure_ascii=False)


def declare(vocab: Vocabulary) -> None:
    """Register the tool with this vocabulary; a repeat with the same schema is skipped."""
    global _declared
    if _ctx is None:
        return
    schema = build_schema(vocab)
    fingerprint = json.dumps(schema, sort_keys=True, ensure_ascii=False)
    if fingerprint == _declared:
        return
    _ctx.register_tool(name=TOOL_NAME, toolset=TOOLSET, schema=schema, handler=handler)
    _declared = fingerprint
    logger.info(
        "yui: generate_express schema declared emotions=%d motions=%d emotion_text=%s",
        len(vocab.emotion_ids),
        len(vocab.motion_ids),
        vocab.emotion_text_mode,
    )
