"""The answer as the agent writes it, cut into the finished sentences ``speech`` frames carry.

Answer tokens arrive on the ``on_stream_delta`` hook with ``kind="text"``, on a hook worker thread
where the gateway's session context is invisible, so they go to the sole connected client; with no
single client connected they go to no chat, and the ``Speaker`` stops every open stream. A gateway turn
runs its agent under a turn id whose session and task parts are the same; a background review
streams on the same surface under a task of its own, and its text is not the reply.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from ..express.segments import opening_cues, split_finished
from ..turns import session, state

logger = logging.getLogger(__name__)

PLATFORM = "yui"
# How many ended turns a late delta is still recognised from; older text reads as the turn in flight.
RETIRED_TURNS = 16

_sink: Callable[[str, str, int, str], None] | None = None


def set_sink(callback: Callable[[str, str, int, str], None] | None) -> None:
    """Who to hand a delta to; the adapter takes them in order on its loop."""
    global _sink
    _sink = callback


def on_stream_delta(
    delta: object = None,
    kind: object = None,
    turn_id: object = None,
    iteration: object = None,
    surface: object = None,
    **_kwargs: object,
) -> None:
    """One streamed answer token. Reasoning, other platforms and background reviews are not ours."""
    if kind != "text" or surface != PLATFORM:
        return
    turn = str(turn_id or "")
    parts = turn.split(":")
    if len(parts) < 2 or parts[0] != parts[1]:
        return
    text = str(delta or "")
    chat_id = session.current_chat_id()
    sink = _sink
    if not text or sink is None:
        return
    try:
        sink(chat_id, turn, int(iteration or 0), text)
    except Exception:
        logger.debug("yui: speech sink failed", exc_info=True)


def _squash(text: str) -> str:
    return "".join(text.split())


@dataclass
class Stream:
    """One chat's answer stream; read and changed only while holding ``lock``.

    A source is one ``(turn_id, iteration)`` of the agent. Whitespace never takes part in matching a
    send against the stream, because the gateway drops a newline that opens a delta.
    """

    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    open: bool = False
    # A speech frame could not go out, so the render carries the rest of the turn.
    off: bool = False
    turns: list[str] = field(default_factory=list)
    retired: deque[str] = field(default_factory=lambda: deque(maxlen=RETIRED_TURNS))
    sealed: set[tuple[str, int]] = field(default_factory=set)
    source: tuple[str, int] | None = None
    raw: str = ""
    cut: int = 0
    # The sentences sent since the last send() that continued them.
    sent: str = ""
    # Where the current source's sentences start in ``sent``.
    source_start: int = 0

    def begin(self, connected: bool) -> None:
        """A turn opens; the turns seen so far are over, and their late text is not its own. A turn
        that opens with no client connected speaks through its render alone."""
        self.retired.extend(self.turns)
        self.turns = []
        self.sealed.clear()
        self.off = not connected
        self.forget()
        self.open = True

    def close(self) -> None:
        self.open = False
        self.forget()

    def seal(self) -> None:
        """A send took the current source; what it streams later is already said."""
        if self.source is not None:
            self.sealed.add(self.source)
        self.forget()

    def forget(self) -> None:
        self.source = None
        self.raw = ""
        self.cut = 0
        self.sent = ""
        self.source_start = 0

    def takes(self, turn_id: str, iteration: int) -> bool:
        """Whether a delta belongs to the open stream; records its turn as seen either way."""
        if turn_id in self.retired or (turn_id, iteration) in self.sealed:
            return False
        if turn_id not in self.turns:
            self.turns.append(turn_id)
        return self.open

    def feed(self, turn_id: str, iteration: int, delta: str) -> list[str]:
        """The sentences this delta finishes; a new source drops the unfinished tail of the last."""
        if self.source != (turn_id, iteration):
            self.source = (turn_id, iteration)
            self.raw = ""
            self.cut = 0
            self.source_start = len(self.sent)
        self.raw += delta
        sentences, end = split_finished(self.raw[self.cut :])
        self.cut += end
        return sentences

    def spoke(self, sentence: str) -> None:
        self.sent += _squash(sentence)

    def unspoken(self, content: str) -> str | None:
        """What a sent reply says past the streamed sentences, or None when it does not continue
        the stream. A reply goes on from every sentence sent, or else from the current source's
        own, when text streamed before a tool call reached no send."""
        whole = _squash(content)
        written = _squash(self.raw)
        for spoken in (self.sent, self.sent[self.source_start :]):
            if whole.startswith(spoken) and (spoken or (written and whole.startswith(written))):
                return _past(content, len(spoken))
        return None


def _past(content: str, count: int) -> str:
    """``content`` after its first ``count`` non-whitespace characters."""
    if not count:
        return content
    for index, char in enumerate(content):
        if not char.isspace():
            count -= 1
            if not count:
                return content[index + 1 :]
    return ""


class Speaker:
    """Every chat's answer stream, and the sentences it hands over to be sent."""

    def __init__(
        self,
        send: Callable[[str, str, list[dict]], Awaitable[bool]],
        as_sent: Callable[[str], str],
    ) -> None:
        self._send = send
        self._as_sent = as_sent
        self.streams: dict[str, Stream] = {}

    def stream(self, chat_id: str) -> Stream:
        stream = self.streams.get(chat_id)
        if stream is None:
            stream = self.streams[chat_id] = Stream()
        return stream

    async def speak(self, chat_id: str, turn_id: str, iteration: int, delta: str) -> None:
        """Send each sentence this delta finishes as a speech frame of its own."""
        if not chat_id:
            await self.stop_all()
            return
        stream = self.stream(chat_id)
        async with stream.lock:
            if not stream.takes(turn_id, iteration):
                return
            if state.is_muted(chat_id):
                # The swallowed reply takes the mute, and text streamed after it would open mid-answer.
                stream.off = True
                return
            for sentence in stream.feed(turn_id, iteration, delta):
                if stream.off:
                    return
                await self._say(chat_id, stream, sentence)

    def stop(self, chat_id: str) -> None:
        """A socket that goes away may not have taken what streamed to it, so the render carries the rest."""
        stream = self.streams.get(chat_id)
        if stream is not None:
            stream.off = True

    async def stop_all(self) -> None:
        """Text that reached no chat leaves a gap in every stream, so their renders carry the rest."""
        for stream in list(self.streams.values()):
            async with stream.lock:
                stream.off = True

    async def _say(self, chat_id: str, stream: Stream, sentence: str) -> None:
        # Spoken as the reply will read, so the send that follows still continues the stream.
        sentence = self._as_sent(sentence)
        if not sentence.strip():
            return
        placements = opening_cues(sentence, state.cues(chat_id))
        if not await self._send(chat_id, sentence, [placement.cue for placement in placements]):
            stream.off = True
            logger.info("yui: speech stopped, the render carries the rest chat=%s", chat_id)
            return
        state.drop_cues(chat_id, placements)
        stream.spoke(sentence)
