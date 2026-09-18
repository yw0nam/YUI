"""The ``generate_express`` tool: every cue of one reply, declared with the client's vocabulary.

The tool list the model sees is memoized per registry generation, so an updated vocabulary reaches
the model by registering the tool again — the registry bumps its generation and the memo drops.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import session, state
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
    named = [
        name
        for ids, name in ((vocab.emotion_ids, "facial expression"), (vocab.motion_ids, "body motion"))
        if ids
    ]
    channels = ", ".join([*named, "voice tone"])
    return (
        f"Place expression cues on the words you are about to speak: {channels}. Call this once "
        "per reply, listing every cue in speaking order, and name for each one the sentence it "
        "belongs before. Spoken words never go in the arguments, and cues never go in the speech."
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


def _cue_schema(vocab: Vocabulary) -> dict:
    properties: dict[str, Any] = {}
    if vocab.emotion_ids:
        properties["emotion_id"] = {
            "type": "string",
            "description": "facial expression",
            "enum": list(vocab.emotion_ids),
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
            "voice direction in natural language (Japanese reads best), applied to the sentence "
            "this cue sits on — independent of emotion_text, and omitted when the default voice fits"
        ),
    }
    properties["sentence"] = {
        "type": "string",
        "description": (
            "the opening words of the sentence this cue is placed before, copied from your reply"
        ),
    }
    return {"type": "object", "properties": properties, "additionalProperties": False}


def build_schema(vocab: Vocabulary) -> dict:
    """The JSON schema the model reads, carrying the ids the client says it can render."""
    return {
        "description": _description(vocab),
        "parameters": {
            "type": "object",
            "properties": {
                "cues": {
                    "type": "array",
                    "description": "every cue of this reply, in speaking order",
                    "items": _cue_schema(vocab),
                }
            },
            "required": ["cues"],
            "additionalProperties": False,
        },
    }


def handler(args: dict, **_kwargs: Any) -> str:
    """Gate each cue against the chat's vocabulary and buffer it for the turn in flight."""
    chat_id = session.current_chat_id()
    vocab = state.vocabulary(chat_id) or Vocabulary()
    calls = (args or {}).get("cues")
    results = []
    for call in calls if isinstance(calls, list) else []:
        result = validate_cue(call if isinstance(call, dict) else {}, vocab)
        cue = cue_of(result["applied"])
        sentence = call.get("sentence") if isinstance(call, dict) else None
        state.append_cue(chat_id, cue, str(sentence or ""))
        if result["warnings"]:
            logger.warning("yui: generate_express dropped input chat=%s %s", chat_id, result["warnings"])
        results.append(result)
    logger.info("yui: generate_express chat=%s cues=%d", chat_id, len(results))
    return json.dumps({"ok": True, "cues": results}, ensure_ascii=False)


def declare(vocab: Vocabulary, chat_id: str = "") -> None:
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
        "yui: generate_express schema declared chat=%s emotions=%d motions=%d emotion_text=%s",
        chat_id,
        len(vocab.emotion_ids),
        len(vocab.motion_ids),
        vocab.emotion_text_mode,
    )
