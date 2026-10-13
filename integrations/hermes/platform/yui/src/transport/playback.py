"""Failed-call notices from a connected client."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from gateway.platforms.event import MessageEvent, MessageType

if TYPE_CHECKING:
    from gateway.session import SessionSource

logger = logging.getLogger(__name__)


class PlaybackNotices:
    def __init__(self) -> None:
        self._error_turns: dict[str, set[str]] = {}

    def record_closed(self, chat_id: str, turn_ids: list[str]) -> None:
        self._error_turns[chat_id] = set(turn_ids)

    async def handle(
        self,
        frame: dict,
        source: SessionSource,
        handle_message: Callable[[MessageEvent], Awaitable[None]],
    ) -> None:
        turn_id = frame.get("turn_id")
        if not isinstance(turn_id, str) or not turn_id or frame.get("ended") != "failed":
            logger.warning("yui: malformed playback frame")
            return
        if turn_id in self._error_turns.get(source.chat_id, ()):
            logger.info("yui: playback failed already error-framed turn=%r", turn_id)
            return
        await handle_message(
            MessageEvent(
                text=f"[playback] failed turn={' '.join(turn_id.split())}",
                message_type=MessageType.TEXT,
                internal=True,
                reply_expected=False,
                allow_gateway_control=False,
                source=source,
            )
        )
