"""The frame size cap and the trimming that keeps a frame under it."""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

MAX_FRAME_BYTES = 262_144


def encoded(frame: dict) -> tuple[str, int]:
    body = json.dumps(frame, ensure_ascii=False)
    return body, len(body.encode("utf-8"))


def fit_frame(frame: dict) -> str | None:
    """The cap is symmetric, and the client closes an oversize frame; trim one down to fit.

    A frame with nothing left to trim has no body to send.
    """
    body, size = encoded(frame)
    if size <= MAX_FRAME_BYTES:
        return body
    # Reasoning is commentary on the reply, so it goes before any of the speech does.
    if frame.pop("reasoning", None) is not None:
        logger.debug("yui: reasoning dropped from an oversize %s frame", frame.get("type"))
        body, size = encoded(frame)
    segments = frame.get("segments")
    while size > MAX_FRAME_BYTES and isinstance(segments, list) and segments:
        segments.pop()
        body, size = encoded(frame)
    if size > MAX_FRAME_BYTES and isinstance(frame.get("delta"), str):
        logger.debug("yui: reasoning delta cut to fit the frame")
        raw = frame["delta"].encode("utf-8")
        budget = max(len(raw) - (size - MAX_FRAME_BYTES), 0)
        frame["delta"] = raw[:budget].decode("utf-8", "ignore")
        body, size = encoded(frame)
    items = frame.get("items")
    if size > MAX_FRAME_BYTES and isinstance(items, list):
        # Oldest first; the summary is the least of what a row shows.
        for item in items:
            if not isinstance(item, dict) or item.pop("summary", None) is None:
                continue
            body, size = encoded(frame)
            if size <= MAX_FRAME_BYTES:
                break
    if size > MAX_FRAME_BYTES:
        logger.warning(
            "yui: %s frame still over %d bytes at %d after trimming",
            frame.get("type"),
            MAX_FRAME_BYTES,
            size,
        )
        return None
    logger.warning("yui: %s frame over %d bytes, trimmed to fit", frame.get("type"), MAX_FRAME_BYTES)
    return body
