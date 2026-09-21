"""YUI platform adapter — one WebSocket per client, turns in and renders out.

The client opens ``/ws``, says ``hello`` with its key and the vocabulary it can render, and keeps
the socket open. Turns arrive on it; the agent's answer leaves on it one finished sentence at a time
as it is written, and the reply that closes it as ordered segments, the ``generate_express`` cues of
that turn already placed on the sentences they belong before. Because the socket stays open, a
report the agent produces on its own leaves the same way.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import hmac
import ipaddress
import itertools
import json
import logging
import os
import sys
import time
from typing import Any

from aiohttp import WSMsgType, web
from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.event import MessageEvent, MessageType, ProcessingOutcome

from ..activity import delegations, reasoning, reports, tool_status
from ..express import tools
from ..express.gate import Vocabulary
from ..express.segments import build_segments, opening_cues, place_matched
from ..speech import speech
from ..turns import state
from .frames import MAX_FRAME_BYTES, encoded, fit_frame

logger = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8646
WS_PATH = "/ws"
SOURCE = "hermes"

# The gateway marks its mid-turn sends; everything else it sends is reply text to speak.
INTERIM_MARKERS = ("expect_edits", "_interim_send")
# The gateway's own notices reach send() unmarked, so _send_with_retry stamps them on the way in.
NOTICE_MARKER = "_yui_gateway_notice"

CLOSE_UNAUTHORIZED = 4401
CLOSE_REPLACED = 4409

# A run the gateway starts on its own still names a turn; the client's ids are decimal digits only.
_TURN_IDS = itertools.count(1)


def _mint_turn_id() -> str:
    return f"hermes-{next(_TURN_IDS)}"


def build_message_text(client_context: str, text: str) -> str:
    """The client_context block, then the utterance — the shape every YUI transport sends."""
    parts = [part for part in (client_context.strip(), text.strip()) if part]
    return "\n\n".join(parts)


def is_loopback(host: str) -> bool:
    """A host only this machine can reach, so a missing key exposes nothing."""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _message_id() -> str:
    return str(int(time.time() * 1000))


def _chat_of(event: MessageEvent) -> str:
    return str(getattr(getattr(event, "source", None), "chat_id", "") or "")


class YuiAdapter(BasePlatformAdapter):
    """The client's socket, seen from the gateway side."""

    # The client renders finished sentences, so the gateway's edited partial messages have nowhere
    # to go and it skips its own streaming for this platform.
    SUPPORTS_MESSAGE_EDITING = False

    def __init__(self, config: Any, **_kwargs: Any) -> None:
        super().__init__(config=config, platform=Platform("yui"))
        extra = getattr(config, "extra", {}) or {}
        # The restart, startup and shutdown pings are the gateway talking about itself.
        if hasattr(config, "gateway_restart_notification"):
            config.gateway_restart_notification = False
            logger.info("yui: gateway restart notifications off for this platform")
        else:
            logger.warning("yui: config has no gateway_restart_notification; restart pings stay on")
        self.host = str(extra.get("host") or DEFAULT_HOST)
        self.port = int(extra.get("port") or DEFAULT_PORT)
        self._key = str(extra.get("key") or os.getenv("YUI_PLATFORM_KEY") or "")
        self._sockets: dict[str, web.WebSocketResponse] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._runner: web.AppRunner | None = None
        self._confirmations: set[asyncio.Task] = set()
        self._closings: set[asyncio.Task] = set()
        self._site: web.TCPSite | None = None
        self._homed: set[str] = set()
        self._reasoning = reasoning.Coalescer(self._send_reasoning)
        self._streams: dict[str, speech.Stream] = {}
        self._sends: set[asyncio.Task] = set()

    @property
    def name(self) -> str:
        return "YUI"

    @property
    def authorization_is_upstream(self) -> bool:
        """The key in the hello frame is the only way onto this socket."""
        return True

    def build_app(self) -> web.Application:
        """The client-facing routes; the runner binds this in connect()."""
        app = web.Application()
        app.router.add_get(WS_PATH, self._serve)
        return app

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not self._key and not is_loopback(self.host):
            logger.error("yui: refusing to serve %s without a key", self.host)
            self._set_fatal_error("no_key", f"YUI needs a key before serving {self.host}", retryable=False)
            return False
        self._loop = asyncio.get_running_loop()
        delegations.set_notifier(self.notify_delegations)
        reasoning.set_sink(self.push_reasoning)
        speech.set_sink(self.push_speech)
        tool_status.set_sink(self.push_tool_status)
        self._runner = web.AppRunner(self.build_app())
        await self._runner.setup()
        try:
            # SO_REUSEADDR lets two sockets silently split traffic on macOS, so it stays off there.
            self._site = web.TCPSite(
                self._runner,
                self.host,
                self.port,
                reuse_address=False if sys.platform == "darwin" else None,
            )
            await self._site.start()
        except OSError as e:
            await self._runner.cleanup()
            self._runner = None
            logger.error("yui: could not bind %s:%s — %s", self.host, self.port, e)
            self._set_fatal_error("bind_failed", f"YUI bind failed: {e}", retryable=True)
            return False
        self._mark_connected()
        logger.info("yui: accepting clients on ws://%s:%s%s", self.host, self.port, WS_PATH)
        return True

    async def disconnect(self) -> None:
        self._mark_disconnected()
        delegations.set_notifier(None)
        reasoning.set_sink(None)
        speech.set_sink(None)
        tool_status.set_sink(None)
        for task in (*self._closings, *self._confirmations, *self._sends):
            task.cancel()
        self._reasoning.close()
        self._closings.clear()
        self._confirmations.clear()
        self._sends.clear()
        for chat_id, ws in list(self._sockets.items()):
            state.set_connected(chat_id, False)
            with contextlib.suppress(Exception):
                await ws.close()
        self._sockets.clear()
        for attribute, method in (("_site", "stop"), ("_runner", "cleanup")):
            held = getattr(self, attribute)
            if held is not None:
                with contextlib.suppress(Exception):
                    await getattr(held, method)()
                setattr(self, attribute, None)

    # -- the socket ---------------------------------------------------------------------------

    async def _serve(self, request: web.Request) -> web.WebSocketResponse:
        """One client connection: the handshake, then turns until it goes away."""
        self._loop = asyncio.get_running_loop()
        # aiohttp refuses an uncompressed frame at max_msg_size, so the cap sits one over the contract's.
        ws = web.WebSocketResponse(max_msg_size=MAX_FRAME_BYTES + 1, heartbeat=30)
        await ws.prepare(request)
        chat_id = ""
        try:
            async for message in ws:
                if message.type is not WSMsgType.TEXT:
                    continue
                frame = self._parse(message.data)
                if frame is None:
                    continue
                if not chat_id:
                    chat_id = await self._greet(ws, frame)
                    if not chat_id:
                        break
                    continue
                await self._on_frame(chat_id, frame)
        finally:
            self._forget(chat_id, ws)
        return ws

    def _parse(self, data: str) -> dict | None:
        try:
            frame = json.loads(data)
        except json.JSONDecodeError:
            logger.warning("yui: dropped a frame that is not JSON")
            return None
        return frame if isinstance(frame, dict) else None

    async def _greet(self, ws: web.WebSocketResponse, frame: dict) -> str:
        """Answer the opening hello; a wrong key leaves with nothing said."""
        if frame.get("type") != "hello":
            return ""
        chat_id = str(frame.get("chat_id") or "").strip()
        if not chat_id or (self._key and not hmac.compare_digest(str(frame.get("key") or ""), self._key)):
            logger.warning("yui: refused a hello for chat %r", chat_id)
            await ws.close(code=CLOSE_UNAUTHORIZED, message=b"unauthorized")
            return ""
        # The new socket is registered before any await, so a mid-handshake send cannot land elsewhere.
        replaced = self._sockets.get(chat_id)
        self._sockets[chat_id] = ws
        state.set_connected(chat_id, True)
        if replaced is not None:
            self._stop_stream(chat_id)
        self._adopt_home_channel(chat_id)
        self._publish_vocabulary(chat_id, frame.get("vocabulary"))
        await self._send_frame(chat_id, {"type": "ready", "chat_id": chat_id})
        if replaced is not None and replaced is not ws:
            # A peer that is gone takes the whole close timeout, and the frames below cannot wait.
            task = asyncio.create_task(self._close_replaced(replaced))
            self._closings.add(task)
            task.add_done_callback(self._closings.discard)
        await self._send_delegations(chat_id)
        logger.info("yui: client ready chat=%s", chat_id)
        # The reply it missed comes before the agent starts a new turn on the held reports.
        await self._flush_renders(chat_id)
        await self._flush_reports(chat_id)
        return chat_id

    async def _close_replaced(self, ws: web.WebSocketResponse) -> None:
        with contextlib.suppress(Exception):
            await ws.close(code=CLOSE_REPLACED, message=b"replaced")

    async def _on_frame(self, chat_id: str, frame: dict) -> None:
        kind = frame.get("type")
        if kind == "turn":
            await self._on_turn(chat_id, frame)
        elif kind == "vocabulary":
            self._publish_vocabulary(chat_id, frame.get("vocabulary"))
        elif kind == "reset":
            await self._on_reset(chat_id)
        elif kind == "stop":
            await self._on_stop(chat_id, frame)
        else:
            logger.debug("yui: ignoring frame type %r", kind)

    def _forget(self, chat_id: str, ws: web.WebSocketResponse) -> None:
        if chat_id and self._sockets.get(chat_id) is ws:
            del self._sockets[chat_id]
            state.set_connected(chat_id, False)
            self._stop_stream(chat_id)
            # Client turn ids restart at 1 per process, so a mark left here would name a new turn.
            state.forget_joined(chat_id)
            logger.info("yui: client gone chat=%s", chat_id)

    def _adopt_home_channel(self, chat_id: str) -> None:
        """The chat on the socket is where cron results and cross-platform messages belong; without
        one the gateway asks the user for `/sethome` on the first message of every session."""
        if chat_id in self._homed or getattr(self.config, "home_channel", None) is not None:
            return
        self._homed.add(chat_id)
        try:
            from gateway.config import HomeChannel, persist_home_channel

            home = HomeChannel(platform=self.platform, chat_id=chat_id, name="YUI")
            persist_home_channel(home)
            self.config.home_channel = home
            logger.info("yui: home channel set chat=%s", chat_id)
        except Exception:
            logger.warning("yui: could not set the home channel chat=%s", chat_id, exc_info=True)

    def _publish_vocabulary(self, chat_id: str, payload: object) -> None:
        vocab = Vocabulary.from_payload(payload)
        state.set_vocabulary(chat_id, vocab)

    def _source(self, chat_id: str):
        return self.build_source(
            chat_id=chat_id, chat_name="YUI", chat_type="dm", user_id="yui", user_name="YUI"
        )

    async def _on_turn(self, chat_id: str, frame: dict) -> None:
        turn_id = str(frame.get("turn_id") or "")
        if not turn_id:
            logger.warning("yui: turn without a turn_id chat=%s", chat_id)
            return
        text = build_message_text(str(frame.get("client_context") or ""), str(frame.get("text") or ""))
        if not text:
            # The contract gives the client no turn timeout, so an empty turn is closed at once.
            logger.warning("yui: nothing to say for an empty turn chat=%s", chat_id)
            await self._send_frame(chat_id, {"type": "turn_end", "turn_id": turn_id})
            return
        logger.info("yui: turn accepted chat=%s turn_id=%s chars=%d", chat_id, turn_id, len(text))
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            message_id=turn_id,
            allow_gateway_control=False,
            source=self._source(chat_id),
        )
        # A busy session may take this text into the turn it runs; the mark goes down before the
        # dispatch because the gateway can run this turn's own hooks inside that call.
        if self._event_session_key(event) in self._active_sessions:
            state.mark_joined(chat_id, turn_id)
        await self.handle_message(event)

    async def _on_reset(self, chat_id: str) -> None:
        """The gateway's own /new: the transcript starts empty under the same chat."""
        # The client asked for the reset, so its acknowledgement is not worth speaking.
        state.set_muted(chat_id, True)
        logger.info("yui: reset chat=%s", chat_id)
        await self.handle_message(
            MessageEvent(
                text="/new",
                message_type=MessageType.TEXT,
                allow_gateway_control=True,
                source=self._source(chat_id),
            )
        )
        # /new ends the delegations still running for this chat.
        delegations.forget(chat_id)
        await self._send_delegations(chat_id)

    async def _on_stop(self, chat_id: str, frame: dict) -> None:
        """The gateway's own /stop: the client stopped every turn outstanding on its side."""
        turn_ids = frame.get("turn_ids")
        if (
            not isinstance(turn_ids, list)
            or not turn_ids
            or not all(isinstance(turn_id, str) for turn_id in turn_ids)
        ):
            logger.debug("yui: ignoring a stop without turn ids chat=%s", chat_id)
            return
        open_ids = state.open_turns(chat_id)
        # A turn opened after the client stopped is not named; stopping with it would end one
        # the client never meant to stop.
        if not open_ids:
            logger.debug("yui: stop with no open turn chat=%s", chat_id)
            return
        unnamed = [turn_id for turn_id in open_ids if turn_id not in turn_ids]
        if unnamed:
            logger.info(
                "yui: stop left alone, open turns unnamed chat=%s turns=%s", chat_id, ",".join(unnamed)
            )
            return
        # The client asked for the stop, so its acknowledgement is not worth speaking.
        state.set_muted(chat_id, True)
        logger.info("yui: stop chat=%s turns=%s", chat_id, ",".join(open_ids))
        await self.handle_message(
            MessageEvent(
                text="/stop",
                message_type=MessageType.TEXT,
                allow_gateway_control=True,
                source=self._source(chat_id),
            )
        )

    async def send_slash_confirm(
        self,
        chat_id: str,
        title: str,
        message: str,
        session_key: str,
        confirm_id: str,
        metadata: dict | None = None,
    ) -> SendResult:
        """Approve the gateway's confirmation: the client's own confirm button was the approval."""
        from tools import slash_confirm

        # Resolving runs the command inline, so it waits for this dispatch to unwind first.
        task = asyncio.create_task(slash_confirm.resolve(session_key, confirm_id, "once"))
        self._confirmations.add(task)
        task.add_done_callback(self._confirmations.discard)
        # The command's own reply comes back to that task instead of through send().
        state.set_muted(chat_id, False)
        logger.info("yui: approved %s for chat=%s", title, chat_id)
        return SendResult(success=True, message_id=_message_id())

    async def _send_frame(self, chat_id: str, frame: dict) -> bool:
        ws = self._sockets.get(chat_id)
        if ws is None or ws.closed:
            logger.warning("yui: no client for chat=%s, dropped %s", chat_id, frame.get("type"))
            return False
        body = fit_frame(frame)
        if body is None:
            return False
        try:
            await ws.send_str(body)
            return True
        except (ConnectionError, RuntimeError, ValueError) as e:
            logger.warning("yui: send failed chat=%s — %s", chat_id, e)
            return False

    async def _send_render(self, chat_id: str, frame: dict) -> None:
        """A reply the client cannot take waits for it; reporting failure would make the gateway
        resend it through its plain-text fallback, stripped of its turn and its cues."""
        if state.is_connected(chat_id) and await self._send_frame(chat_id, frame):
            return
        reports.queue_render(chat_id, frame)
        logger.info("yui: reply held for an away client chat=%s", chat_id)
        # A socket that became ready during the send above has already run its own flush.
        if state.is_connected(chat_id):
            await self._flush_renders(chat_id)

    async def _flush_renders(self, chat_id: str) -> None:
        held, dropped = reports.take_renders(chat_id)
        if dropped:
            logger.warning("yui: %d held reply(s) dropped chat=%s", dropped, chat_id)
        for index, frame in enumerate(held):
            if not await self._send_frame(chat_id, frame):
                for unsent in held[index:]:
                    reports.queue_render(chat_id, unsent)
                return

    # -- reports and delegations --------------------------------------------------------------

    async def handle_message(self, event: MessageEvent) -> None:
        """Hold a report for a client that is away; everything else goes to the gateway now."""
        if getattr(event, "internal", False):
            chat_id = _chat_of(event)
            if not state.is_connected(chat_id):
                reports.queue(chat_id, event)
                # This adapter owns delivery from here, so the gateway must not requeue it.
                event._gateway_accepted = True
                logger.info("yui: report held for an away client chat=%s", chat_id)
                return
        await super().handle_message(event)

    async def _flush_reports(self, chat_id: str) -> None:
        held, dropped = reports.take(chat_id)
        if not held:
            return
        logger.info("yui: delivering %d held report(s) chat=%s dropped=%d", len(held), chat_id, dropped)
        if len(held) == 1:
            await super().handle_message(held[0])
            return
        await super().handle_message(
            MessageEvent(
                text=reports.merged_text([event.text for event in held], dropped),
                message_type=MessageType.TEXT,
                internal=True,
                allow_gateway_control=False,
                source=self._source(chat_id),
            )
        )

    async def _send_delegations(self, chat_id: str) -> bool:
        return await self._send_frame(chat_id, {"type": "delegations", "items": delegations.items(chat_id)})

    def notify_delegations(self, chat_id: str) -> None:
        """Called from the subagent hooks, which run on the agent's thread, not the gateway loop."""
        loop = self._loop
        if loop is None or not state.is_connected(chat_id):
            return

        def report(future: concurrent.futures.Future) -> None:
            if future.cancelled():
                return
            error = future.exception()
            if error is not None:
                logger.warning("yui: delegations push failed chat=%s — %s", chat_id, error)

        with contextlib.suppress(RuntimeError):
            asyncio.run_coroutine_threadsafe(self._send_delegations(chat_id), loop).add_done_callback(report)

    # -- reasoning ----------------------------------------------------------------------------

    def push_reasoning(self, chat_id: str, delta: str) -> None:
        """Called from the stream hook, which runs on a hook worker thread, not this loop."""
        loop = self._loop
        if loop is None or not state.is_connected(chat_id):
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._reasoning.collect, chat_id, delta)

    async def _send_reasoning(self, chat_id: str, delta: str) -> None:
        # A delta whose turn closed inside the window names no turn; the client could not place it.
        turn = state.turn_id(chat_id)
        if turn is not None:
            await self._send_frame(chat_id, {"type": "reasoning", "turn_id": turn, "delta": delta})

    # -- speech -------------------------------------------------------------------------------

    def push_speech(self, chat_id: str, turn_id: str, iteration: int, delta: str) -> None:
        """Called from the stream hook, which runs on a hook worker thread, not this loop."""
        loop = self._loop
        if loop is None:
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._collect_speech, chat_id, turn_id, iteration, delta)

    def _collect_speech(self, chat_id: str, turn_id: str, iteration: int, delta: str) -> None:
        # Deltas wait on the stream lock in the order they arrive.
        task = asyncio.create_task(self._speak_delta(chat_id, turn_id, iteration, delta))
        self._sends.add(task)
        task.add_done_callback(self._sends.discard)

    def _stream(self, chat_id: str) -> speech.Stream:
        stream = self._streams.get(chat_id)
        if stream is None:
            stream = self._streams[chat_id] = speech.Stream()
        return stream

    async def _speak_delta(self, chat_id: str, turn_id: str, iteration: int, delta: str) -> None:
        """Send each sentence this delta finishes as a speech frame of its own."""
        if not chat_id:
            await self._stop_streams()
            return
        stream = self._stream(chat_id)
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
                await self._send_speech(chat_id, stream, sentence)

    def _stop_stream(self, chat_id: str) -> None:
        """A socket that goes away may not have taken what streamed to it, so the render carries the rest."""
        stream = self._streams.get(chat_id)
        if stream is not None:
            stream.off = True

    async def _stop_streams(self) -> None:
        """Text that reached no chat leaves a gap in every stream, so their renders carry the rest."""
        for stream in list(self._streams.values()):
            async with stream.lock:
                stream.off = True

    def _as_sent(self, text: str) -> str:
        """The text the gateway would send, in the order it cleans a reply."""
        text = self.extract_media(text)[1]
        text = self.extract_images(text)[1]
        return self.extract_local_files(self.strip_media_directives_for_display(text))[1]

    async def _send_speech(self, chat_id: str, stream: speech.Stream, sentence: str) -> None:
        # Spoken as the reply will read, so the send that follows still continues the stream.
        sentence = self._as_sent(sentence)
        if not sentence.strip():
            return
        placements = opening_cues(sentence, state.cues(chat_id))
        segment = {"cues": [placement.cue for placement in placements], "speech": sentence}
        frame = {"type": "speech", "turn_id": state.turn_id(chat_id), "segments": [segment]}
        # A speech frame is never held, and trimming it would drop its only sentence.
        if (
            not state.is_connected(chat_id)
            or encoded(frame)[1] > MAX_FRAME_BYTES
            or not await self._send_frame(chat_id, frame)
        ):
            stream.off = True
            logger.info("yui: speech stopped, the render carries the rest chat=%s", chat_id)
            return
        state.drop_cues(chat_id, placements)
        stream.spoke(sentence)

    # -- tool status --------------------------------------------------------------------------

    def push_tool_status(self, chat_id: str, tool_state: str, tool_name: str) -> None:
        """Called from the tool hooks, which run on a hook worker thread, not this loop."""
        loop = self._loop
        if loop is None or not state.is_connected(chat_id):
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._collect_tool_status, chat_id, tool_state, tool_name)

    def _collect_tool_status(self, chat_id: str, tool_state: str, tool_name: str) -> None:
        task = asyncio.create_task(self._send_tool_status(chat_id, tool_state, tool_name))
        self._sends.add(task)
        task.add_done_callback(self._sends.discard)

    async def _send_tool_status(self, chat_id: str, tool_state: str, tool_name: str) -> None:
        """A call on a chat that holds no turn is not a YUI turn's; never held, never retried."""
        turn = state.turn_id(chat_id)
        if turn is None:
            return
        await self._send_frame(
            chat_id,
            {"type": "tool_status", "turn_id": turn, "state": tool_state, "tool_id": tool_name},
        )

    # -- replies ------------------------------------------------------------------------------

    async def _send_with_retry(
        self,
        chat_id: str,
        content: str,
        reply_to: str | None = None,
        metadata: Any = None,
        max_retries: int = 2,
        base_delay: float = 2.0,
    ) -> SendResult:
        """The busy path sends its acknowledgement here and marks nothing; the agent's own replies
        arrive marked notify. Mark the rest, so send() knows the gateway wrote it."""
        meta = dict(metadata or {})
        if not meta.get("notify"):
            meta[NOTICE_MARKER] = True
        return await super()._send_with_retry(
            chat_id=chat_id,
            content=content,
            reply_to=reply_to,
            metadata=meta,
            max_retries=max_retries,
            base_delay=base_delay,
        )

    async def send_or_update_status(
        self,
        chat_id: str,
        status_key: str,
        content: str,
        metadata: dict | None = None,
    ) -> SendResult:
        """Every status notice the gateway writes lands here, and none of it is speech."""
        logger.info("yui: status %s not spoken chat=%s", status_key, chat_id)
        return SendResult(success=True, message_id=_message_id())

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: str | None = None,
        metadata: dict | None = None,
    ) -> SendResult:
        """Render a reply, then end the failed turns that were waiting for it."""
        result = await self._deliver(chat_id, content, metadata or {})
        await self._close_failed(chat_id)
        return result

    async def _deliver(self, chat_id: str, content: str, meta: dict) -> SendResult:
        """Render a reply; only the gateway's own markers keep a send off the wire."""
        if meta.get(NOTICE_MARKER):
            logger.info("yui: gateway notice not spoken chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        if not (content or "").strip() or any(meta.get(marker) for marker in INTERIM_MARKERS):
            logger.debug("yui: nothing to render for this send chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        if state.take_muted(chat_id):
            state.pop_cues(chat_id)
            state.mark_delivered(chat_id)
            logger.info("yui: acknowledgement not spoken chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        stream = self._stream(chat_id)
        async with stream.lock:
            rest = stream.unspoken(content)
            if rest is None:
                if stream.sent:
                    logger.info("yui: send does not continue the streamed text chat=%s", chat_id)
                rest = content
            else:
                stream.seal()
            placements = state.pop_cues(chat_id)
            if meta.get("notify"):
                stream.close()
                segments = build_segments(rest, placements)
                if not segments and placements:
                    segments = [{"cues": [placement.cue for placement in placements], "speech": ""}]
            else:
                # Mid-turn text takes only the cues it names; the rest belong to what comes after.
                segments, waiting = place_matched(rest, placements)
                for placement in waiting:
                    state.append_cue(chat_id, placement.cue, placement.sentence)
            state.mark_delivered(chat_id)
            turn_id = state.turn_id(chat_id)
            frame = self._render(turn_id, segments, reasoning.live_text(chat_id))
            await self._send_render(chat_id, frame)
            # A render with no turn in flight ends the turn it minted; nothing else closes it.
            if turn_id is None:
                await self._send_render(chat_id, {"type": "turn_end", "turn_id": frame["turn_id"]})
        return SendResult(success=True, message_id=_message_id())

    def _render(self, turn_id: str | None, segments: list[dict], reasoning_text: str = "") -> dict:
        if turn_id is None:
            turn_id = _mint_turn_id()
            logger.warning("yui: render with no turn in flight, minted %s", turn_id)
        frame = {"type": "render", "turn_id": turn_id, "source": SOURCE, "segments": segments}
        if reasoning_text:
            frame["reasoning"] = reasoning_text
        return frame

    async def send_typing(self, chat_id: str, metadata: dict | None = None) -> None:
        return None

    # -- media --------------------------------------------------------------------------------

    def _should_auto_tts_for_chat(self, chat_id: str) -> bool:
        """The client speaks the reply itself, so `voice.auto_tts` buys this platform nothing."""
        return False

    def _drop_media(self, kind: str, chat_id: str, path: str) -> SendResult:
        """The base defaults put a "couldn't deliver" line in the reply; this platform speaks only."""
        logger.info("yui: %s not delivered chat=%s path=%s", kind, chat_id, path)
        return SendResult(success=True, message_id=_message_id())

    async def send_voice(
        self,
        chat_id: str,
        audio_path: str,
        caption: str | None = None,
        reply_to: str | None = None,
        metadata: dict | None = None,
        **_kwargs: Any,
    ) -> SendResult:
        """`/voice all` reaches here past the auto-TTS probe, so the drop has to happen here too."""
        return self._drop_media("audio", chat_id, audio_path)

    async def send_document(
        self,
        chat_id: str,
        file_path: str,
        caption: str | None = None,
        file_name: str | None = None,
        reply_to: str | None = None,
        metadata: dict | None = None,
        **_kwargs: Any,
    ) -> SendResult:
        return self._drop_media("file", chat_id, file_path)

    async def send_video(
        self,
        chat_id: str,
        video_path: str,
        caption: str | None = None,
        reply_to: str | None = None,
        metadata: dict | None = None,
        **_kwargs: Any,
    ) -> SendResult:
        return self._drop_media("video", chat_id, video_path)

    async def send_image_file(
        self,
        chat_id: str,
        image_path: str,
        caption: str | None = None,
        reply_to: str | None = None,
        metadata: dict | None = None,
        **_kwargs: Any,
    ) -> SendResult:
        return self._drop_media("image", chat_id, image_path)

    async def send_image(
        self,
        chat_id: str,
        image_url: str,
        caption: str | None = None,
        reply_to: str | None = None,
        metadata: dict | None = None,
    ) -> SendResult:
        """The base default speaks the URL; a link has nothing to say out loud."""
        return self._drop_media("image", chat_id, image_url)

    async def get_chat_info(self, chat_id: str) -> dict:
        return {"name": "YUI", "type": "dm", "chat_id": chat_id}

    async def _close_failed(self, chat_id: str) -> None:
        """A failed turn ends behind the failure line the gateway writes after it."""
        if not state.take_closing(chat_id):
            return
        stream = self._stream(chat_id)
        async with stream.lock:
            stream.close()
            for turn_id in state.close_turns(chat_id):
                await self._send_render(chat_id, {"type": "turn_end", "turn_id": turn_id})

    async def on_processing_start(self, event: MessageEvent) -> None:
        """The turn opens here: the gateway serialises this per session, admission does not."""
        chat_id = _chat_of(event)
        await self._close_failed(chat_id)
        stream = self._stream(chat_id)
        async with stream.lock:
            state.reset(chat_id)
            stream.begin(connected=state.is_connected(chat_id))
            reasoning.clear(chat_id)
            self._reasoning.forget(chat_id)
            internal = getattr(event, "internal", False)
            message_id = getattr(event, "message_id", "") or ""
            # Hooks of its own make this a turn, so it ends on its own and not with the one it joined.
            state.drop_joined(chat_id, message_id)
            turn_id = _mint_turn_id() if internal or not message_id else message_id
            # A minted id has nowhere else to live, and the completion of that event has to find it.
            event._yui_turn_id = turn_id
            state.open_turn(chat_id, turn_id)
        vocab = state.vocabulary(chat_id)
        # ponytail: one schema per process; chats whose turns overlap can read each other's ids
        if vocab is not None:
            tools.declare(vocab, chat_id)

    async def on_processing_complete(self, event: MessageEvent, outcome: ProcessingOutcome) -> None:
        """Close the turn: a reply already rendered, anything else renders as silence."""
        chat_id = _chat_of(event)
        turn_id = getattr(event, "_yui_turn_id", "") or getattr(event, "message_id", "") or ""
        if turn_id in state.open_turns(chat_id)[1:]:
            # An older turn is still open, and its task delivers this reply after this hook.
            logger.debug("yui: turn %s finished inside an open turn chat=%s", turn_id, chat_id)
            return
        if outcome is ProcessingOutcome.FAILURE:
            logger.info("yui: failed turn waits for its failure line chat=%s", chat_id)
            state.mark_closing(chat_id)
            return
        stream = self._stream(chat_id)
        async with stream.lock:
            streamed = bool(stream.sent)
            stream.close()
            # turn_id goes before close_turns, which clears what it reads.
            addressed = state.turn_id(chat_id)
            ended = state.close_turns(chat_id)
            delivered = state.take_delivered(chat_id)
            if not delivered and not streamed:
                logger.info("yui: turn ended without speech chat=%s outcome=%s", chat_id, outcome)
            # Sentences streamed after the last render still leave the turn's unplaced cues to play.
            if streamed or not delivered:
                cues = [placement.cue for placement in state.pop_cues(chat_id)]
                # Cues on a silent turn still play; the segment they ride on carries no speech.
                if cues:
                    frame = self._render(addressed, [{"cues": cues, "speech": ""}])
                    await self._send_render(chat_id, frame)
                    ended = ended or [frame["turn_id"]]
            for ended_id in ended:
                await self._send_render(chat_id, {"type": "turn_end", "turn_id": ended_id})
