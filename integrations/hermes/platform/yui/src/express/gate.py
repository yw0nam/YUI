"""Expression-cue validation gate — the Expression Broker's rules, inlined.

The vocabulary a cue is checked against is the one YUI ships with every pushed turn, so the
broker process is not in this path. Unknown emotion/motion ids are dropped with a warning and
the call still succeeds: a bad cue must never block speech.
"""

from __future__ import annotations

from dataclasses import dataclass, field

CAPTION_MAX_LEN = 200


@dataclass
class Vocabulary:
    """What the client can currently render, as published in its hello."""

    emotion_ids: list[str] = field(default_factory=list)
    motion_ids: list[str] = field(default_factory=list)
    emotion_text_mode: str = "free"
    emotion_text_map: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: object) -> Vocabulary:
        data = payload if isinstance(payload, dict) else {}
        mode = data.get("emotion_text_mode")
        table = data.get("emotion_text_map")

        def ids(key: str) -> list[str]:
            raw = data.get(key)
            return [i for i in raw or [] if isinstance(i, str) and i.strip()]

        return cls(
            emotion_ids=ids("emotion_ids"),
            motion_ids=ids("motion_ids"),
            emotion_text_mode="enum" if mode == "enum" else "free",
            emotion_text_map=dict(table) if isinstance(table, dict) else {},
        )


def tokenize_emotion_text(text: str, table: dict[str, str]) -> tuple[list[str], str]:
    """Split ``text`` into known table tokens and unknown leftover, longest key first."""
    keys = sorted(table, key=len, reverse=True)
    known: list[str] = []
    unknown: list[str] = []
    i = 0
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        for key in keys:
            if key and text.startswith(key, i):
                known.append(key)
                i += len(key)
                break
        else:
            unknown.append(text[i])
            i += 1
    return known, "".join(unknown)


def validate_cue(args: dict, vocab: Vocabulary) -> dict:
    """Apply the gate to one ``generate_express`` call; the ack shape the broker returns."""
    warnings: list[str] = []

    def text_arg(key: str) -> str | None:
        value = args.get(key)
        return value if isinstance(value, str) else None

    emotion_id = text_arg("emotion_id")
    applied_emotion = emotion_id
    if emotion_id is not None and emotion_id not in vocab.emotion_ids:
        warnings.append(f"emotion_id '{emotion_id}' not in live vocabulary (dropped)")
        applied_emotion = None

    motion_id = text_arg("motion_id")
    applied_motion = motion_id
    if motion_id is not None and motion_id not in vocab.motion_ids:
        warnings.append(f"motion_id '{motion_id}' not in live vocabulary (dropped)")
        applied_motion = None

    emotion_text = text_arg("emotion_text")
    applied_text = emotion_text
    dropped_table: dict[str, str] | None = None
    if emotion_text is not None and vocab.emotion_text_mode == "enum":
        known, unknown = tokenize_emotion_text(emotion_text, vocab.emotion_text_map)
        applied_text = "".join(known) or None
        if unknown:
            warnings.append(f"emotion_text contains tokens not in live table (dropped): {unknown!r}")
            dropped_table = dict(vocab.emotion_text_map)

    caption = text_arg("caption")
    applied_caption = caption.strip() if caption is not None else None
    if applied_caption == "":
        applied_caption = None
    elif applied_caption is not None and len(applied_caption) > CAPTION_MAX_LEN:
        warnings.append(f"caption longer than {CAPTION_MAX_LEN} chars (truncated)")
        applied_caption = applied_caption[:CAPTION_MAX_LEN]

    result = {
        "ok": True,
        "applied": {
            "emotion_id": applied_emotion,
            "motion_id": applied_motion,
            "emotion_text": applied_text,
            "caption": applied_caption,
        },
        "warnings": warnings,
    }
    if dropped_table is not None:
        result["emotion_text_table"] = dropped_table
    return result


def cue_of(applied: dict) -> dict:
    """The render-payload cue for an applied result — absent fields are omitted."""
    return {k: v for k, v in applied.items() if v is not None}
