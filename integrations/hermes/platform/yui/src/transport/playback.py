"""Playback outcomes from a connected client."""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from gateway.platforms.event import MessageEvent, MessageType

if TYPE_CHECKING:
    from gateway.session import SessionSource

logger = logging.getLogger(__name__)


async def handle_playback(
    frame: dict,
    source: SessionSource,
    handle_message: Callable[[MessageEvent], Awaitable[None]],
) -> None:
    turn_id = frame.get("turn_id")
    ended = frame.get("ended")
    if (
        not isinstance(turn_id, str)
        or not turn_id
        or ended
        not in (
            "complete",
            "interrupted",
            "failed",
        )
    ):
        logger.warning("yui: malformed playback frame")
        return
    if ended == "complete":
        logger.info("yui: playback complete turn=%s", turn_id)
        return
    text = f"[playback] {ended} turn={' '.join(turn_id.split())}"
    for field in ("spoken", "unspoken"):
        part = frame.get(field)
        if isinstance(part, str) and part:
            text += f" {field}={json.dumps(' '.join(part.split()), ensure_ascii=False)}"
    await handle_message(
        MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            internal=True,
            reply_expected=False,
            allow_gateway_control=False,
            source=source,
        )
    )
