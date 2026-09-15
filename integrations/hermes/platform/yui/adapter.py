"""YUI platform adapter — one WebSocket per client, turns in and renders out.

The client opens ``/ws``, says ``hello`` with its key and the vocabulary it can render, and keeps
the socket open. Turns arrive on it; the agent's final reply leaves on it as ordered segments, the
``generate_express`` cues of that turn already placed on the sentences they belong before. Because
the socket stays open, a report the agent produces on its own leaves the same way.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
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

from . import delegations, reasoning, reports, state, tools
from .gate import Vocabulary
from .segments import build_segments, place_matched

logger = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8646
WS_PATH = "/ws"
SOURCE = "hermes"
MAX_FRAME_BYTES = 262_144

# The gateway marks its mid-turn sends; everything else it sends is reply text to speak.
INTERIM_MARKERS = ("expect_edits", "_interim_send")
# The gateway's own notices reach send() unmarked, so _send_with_retry stamps them on the way in.
NOTICE_MARKER = "_yui_gateway_notice"

# One reasoning frame per window, so a token stream does not become a frame stream.
REASONING_WINDOW_SECONDS = 0.1

CLOSE_UNAUTHORIZED = 4401
CLOSE_REPLACED = 4409
CLOSE_TOO_BIG = 1009


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


def _encoded(frame: dict) -> tuple[str, int]:
    body = json.dumps(frame, ensure_ascii=False)
    return body, len(body.encode("utf-8"))


def fit_frame(frame: dict) -> str:
    """The cap is symmetric, and the client closes an oversize frame; trim one down to fit."""
    body, size = _encoded(frame)
    if size <= MAX_FRAME_BYTES:
        return body
    # Reasoning is commentary on the reply, so it goes before any of the speech does.
    if frame.pop("reasoning", None) is not None:
        logger.debug("yui: reasoning dropped from an oversize %s frame", frame.get("type"))
        body, size = _encoded(frame)
    segments = frame.get("segments")
    while size > MAX_FRAME_BYTES and isinstance(segments, list) and segments:
        segments.pop()
        body, size = _encoded(frame)
    if size > MAX_FRAME_BYTES and isinstance(frame.get("delta"), str):
        logger.debug("yui: reasoning delta cut to fit the frame")
        raw = frame["delta"].encode("utf-8")
        budget = max(len(raw) - (size - MAX_FRAME_BYTES), 0)
        frame["delta"] = raw[:budget].decode("utf-8", "ignore")
        body, size = _encoded(frame)
    logger.warning("yui: %s frame over %d bytes, trimmed to fit", frame.get("type"), MAX_FRAME_BYTES)
    return body


def _message_id() -> str:
    return str(int(time.time() * 1000))


def _chat_of(event: MessageEvent) -> str:
    return str(getattr(getattr(event, "source", None), "chat_id", "") or "")


class YuiAdapter(BasePlatformAdapter):
    """The client's socket, seen from the gateway side."""

    # The client renders finished sentences, so partial text has nowhere to go and the gateway
    # skips streaming for this platform.
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
        self._site: web.TCPSite | None = None
        self._homed: set[str] = set()
        self._reasoning_pending: dict[str, list[str]] = {}
        self._reasoning_flushes: dict[str, asyncio.Task] = {}

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
        for task in list(self._reasoning_flushes.values()):
            task.cancel()
        self._reasoning_flushes.clear()
        self._reasoning_pending.clear()
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
        ws = web.WebSocketResponse(max_msg_size=MAX_FRAME_BYTES * 4, heartbeat=30)
        await ws.prepare(request)
        chat_id = ""
        try:
            async for message in ws:
                if message.type is not WSMsgType.TEXT:
                    continue
                if len(message.data.encode("utf-8")) > MAX_FRAME_BYTES:
                    logger.warning("yui: frame over %d bytes, closing", MAX_FRAME_BYTES)
                    await ws.close(code=CLOSE_TOO_BIG, message=b"frame too large")
                    break
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
        if not chat_id or (self._key and str(frame.get("key") or "") != self._key):
            logger.warning("yui: refused a hello for chat %r", chat_id)
            await ws.close(code=CLOSE_UNAUTHORIZED, message=b"unauthorized")
            return ""
        replaced = self._sockets.get(chat_id)
        if replaced is not None and replaced is not ws:
            with contextlib.suppress(Exception):
                await replaced.close(code=CLOSE_REPLACED, message=b"replaced")
        self._sockets[chat_id] = ws
        state.set_connected(chat_id, True)
        self._adopt_home_channel(chat_id)
        self._publish_vocabulary(chat_id, frame.get("vocabulary"))
        await self._send_frame(chat_id, {"type": "ready", "chat_id": chat_id})
        await self._send_delegations(chat_id)
        logger.info("yui: client ready chat=%s", chat_id)
        # The reply it missed comes before the agent starts a new turn on the held reports.
        await self._flush_renders(chat_id)
        await self._flush_reports(chat_id)
        return chat_id

    async def _on_frame(self, chat_id: str, frame: dict) -> None:
        kind = frame.get("type")
        if kind == "turn":
            await self._on_turn(chat_id, frame)
        elif kind == "vocabulary":
            self._publish_vocabulary(chat_id, frame.get("vocabulary"))
        elif kind == "reset":
            await self._on_reset(chat_id)
        else:
            logger.debug("yui: ignoring frame type %r", kind)

    def _forget(self, chat_id: str, ws: web.WebSocketResponse) -> None:
        if chat_id and self._sockets.get(chat_id) is ws:
            del self._sockets[chat_id]
            state.set_connected(chat_id, False)
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
        tools.declare(vocab)

    def _source(self, chat_id: str):
        return self.build_source(
            chat_id=chat_id, chat_name="YUI", chat_type="dm", user_id="yui", user_name="YUI"
        )

    async def _on_turn(self, chat_id: str, frame: dict) -> None:
        turn_id = str(frame.get("turn_id") or "")
        text = build_message_text(str(frame.get("client_context") or ""), str(frame.get("text") or ""))
        if not text:
            # The contract gives the client no turn timeout, so an empty turn is closed at once.
            logger.warning("yui: nothing to say for an empty turn chat=%s", chat_id)
            await self._send_frame(chat_id, self._render(turn_id or None, []))
            return
        logger.info("yui: turn accepted chat=%s turn_id=%s chars=%d", chat_id, turn_id, len(text))
        await self.handle_message(
            MessageEvent(
                text=text,
                message_type=MessageType.TEXT,
                message_id=turn_id or None,
                allow_gateway_control=False,
                source=self._source(chat_id),
            )
        )

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
        try:
            await ws.send_str(fit_frame(frame))
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
        with contextlib.suppress(RuntimeError):
            asyncio.run_coroutine_threadsafe(self._send_delegations(chat_id), loop)

    # -- reasoning ----------------------------------------------------------------------------

    def push_reasoning(self, chat_id: str, delta: str) -> None:
        """Called from the stream hook, which runs on a hook worker thread, not this loop."""
        loop = self._loop
        if loop is None or not state.is_connected(chat_id):
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._collect_reasoning, chat_id, delta)

    def _collect_reasoning(self, chat_id: str, delta: str) -> None:
        self._reasoning_pending.setdefault(chat_id, []).append(delta)
        self._arm_reasoning_flush(chat_id)

    def _arm_reasoning_flush(self, chat_id: str) -> None:
        if chat_id not in self._reasoning_flushes:
            self._reasoning_flushes[chat_id] = asyncio.create_task(self._flush_reasoning(chat_id))

    def _forget_reasoning(self, chat_id: str) -> None:
        """A new turn thinks from nothing, so the last one's tail is not its opening words."""
        # Pending goes first: a cancelled flush re-arms from its finally only when pending is non-empty.
        self._reasoning_pending.pop(chat_id, None)
        flush = self._reasoning_flushes.pop(chat_id, None)
        if flush is not None:
            flush.cancel()

    async def _flush_reasoning(self, chat_id: str) -> None:
        """What arrived during the window leaves as one frame; the client shows thinking, not text."""
        try:
            await asyncio.sleep(REASONING_WINDOW_SECONDS)
            delta = "".join(self._reasoning_pending.pop(chat_id, []))
            if delta:
                await self._send_frame(chat_id, {"type": "reasoning", "delta": delta})
        finally:
            # No running loop only when the coroutine is collected after loop teardown.
            with contextlib.suppress(RuntimeError):
                if self._reasoning_flushes.get(chat_id) is asyncio.current_task():
                    self._reasoning_flushes.pop(chat_id, None)
                # A delta that arrived during the send found this flush still armed and scheduled none.
                if self._reasoning_pending.get(chat_id):
                    self._arm_reasoning_flush(chat_id)

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
        """Render a reply; only the gateway's own markers keep a send off the wire."""
        meta = metadata or {}
        if meta.get(NOTICE_MARKER):
            logger.info("yui: gateway notice not spoken chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        if not (content or "").strip() or any(meta.get(marker) for marker in INTERIM_MARKERS):
            logger.debug("yui: nothing to render for this send chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        if state.take_muted(chat_id):
            state.pop_cues(chat_id)
            state.mark_delivered(chat_id)
            logger.info("yui: reset acknowledgement not spoken chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        block, content = reasoning.split_block(content)
        if block:
            logger.debug("yui: reasoning block stripped chat=%s", chat_id)
        placements = state.pop_cues(chat_id)
        if meta.get("notify"):
            segments = build_segments(content, placements)
        else:
            # Mid-turn text takes only the cues it names; the rest belong to what comes after.
            segments, waiting = place_matched(content, placements)
            for placement in waiting:
                state.append_cue(chat_id, placement.cue, placement.sentence)
        state.mark_delivered(chat_id)
        # The streamed tokens are the whole thought; the block is cut to fifteen lines.
        frame = self._render(state.take_turn_id(chat_id), segments, reasoning.live_text(chat_id) or block)
        await self._send_render(chat_id, frame)
        return SendResult(success=True, message_id=_message_id())

    def _render(self, turn_id: str | None, segments: list[dict], reasoning_text: str = "") -> dict:
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

    async def on_processing_start(self, event: MessageEvent) -> None:
        """The turn opens here: the gateway serialises this per session, admission does not."""
        chat_id = _chat_of(event)
        state.reset(chat_id)
        reasoning.clear(chat_id)
        self._forget_reasoning(chat_id)
        internal = getattr(event, "internal", False)
        state.set_turn_id(chat_id, None if internal else (event.message_id or None))

    async def on_processing_complete(self, event: MessageEvent, outcome: ProcessingOutcome) -> None:
        """Close the turn: a reply already rendered, anything else renders as silence."""
        chat_id = _chat_of(event)
        cues = [placement.cue for placement in state.pop_cues(chat_id)]
        if state.take_delivered(chat_id):
            return
        logger.info("yui: turn ended without speech chat=%s outcome=%s", chat_id, outcome)
        # Cues on a silent turn still play; the segment they ride on carries no speech.
        segments = [{"cues": cues, "speech": ""}] if cues else []
        await self._send_render(chat_id, self._render(state.take_turn_id(chat_id), segments))
