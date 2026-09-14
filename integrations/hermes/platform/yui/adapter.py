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

from . import delegations, reports, state, tools
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


def fit_frame(frame: dict) -> str:
    """The cap is symmetric, and the client closes an oversize frame; trim a render to fit."""
    body = json.dumps(frame, ensure_ascii=False)
    if len(body.encode("utf-8")) <= MAX_FRAME_BYTES:
        return body
    segments = frame.get("segments")
    while isinstance(segments, list) and segments:
        segments.pop()
        body = json.dumps(frame, ensure_ascii=False)
        if len(body.encode("utf-8")) <= MAX_FRAME_BYTES:
            break
    logger.warning(
        "yui: %s frame over %d bytes, trailing segments dropped", frame.get("type"), MAX_FRAME_BYTES
    )
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
        self.host = str(extra.get("host") or DEFAULT_HOST)
        self.port = int(extra.get("port") or DEFAULT_PORT)
        self._key = str(extra.get("key") or os.getenv("YUI_PLATFORM_KEY") or "")
        self._sockets: dict[str, web.WebSocketResponse] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._runner: web.AppRunner | None = None
        self._confirmations: set[asyncio.Task] = set()
        self._site: web.TCPSite | None = None

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

    # -- replies ------------------------------------------------------------------------------

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: str | None = None,
        metadata: dict | None = None,
    ) -> SendResult:
        """Render a reply; only the gateway's own mid-turn markers keep a send off the wire."""
        meta = metadata or {}
        if not (content or "").strip() or any(meta.get(marker) for marker in INTERIM_MARKERS):
            logger.debug("yui: nothing to render for this send chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        if state.take_muted(chat_id):
            state.pop_cues(chat_id)
            state.mark_delivered(chat_id)
            logger.info("yui: reset acknowledgement not spoken chat=%s", chat_id)
            return SendResult(success=True, message_id=_message_id())
        placements = state.pop_cues(chat_id)
        if meta.get("notify"):
            segments = build_segments(content, placements)
        else:
            # Mid-turn text takes only the cues it names; the rest belong to what comes after.
            segments, waiting = place_matched(content, placements)
            for placement in waiting:
                state.append_cue(chat_id, placement.cue, placement.sentence)
        state.mark_delivered(chat_id)
        await self._send_render(chat_id, self._render(state.take_turn_id(chat_id), segments))
        return SendResult(success=True, message_id=_message_id())

    def _render(self, turn_id: str | None, segments: list[dict]) -> dict:
        return {"type": "render", "turn_id": turn_id, "source": SOURCE, "segments": segments}

    async def send_typing(self, chat_id: str, metadata: dict | None = None) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> dict:
        return {"name": "YUI", "type": "dm", "chat_id": chat_id}

    async def on_processing_start(self, event: MessageEvent) -> None:
        """The turn opens here: the gateway serialises this per session, admission does not."""
        chat_id = _chat_of(event)
        state.reset(chat_id)
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
