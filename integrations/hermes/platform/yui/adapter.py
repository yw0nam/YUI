"""YUI platform adapter — a loopback HTTP server in, the YUI render ingress out.

``POST /turn`` carries one YUI turn (the rendered client_context block, the utterance, and the
vocabulary the client can render) and is answered 202 as soon as the gateway accepts it. The
final reply leaves through ``send()`` and is POSTed to YUI's ``/render`` route together with the
``generate_express`` cues the model fired during that turn.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.event import MessageEvent, MessageType, ProcessingOutcome

from . import state, tools
from .gate import Vocabulary

logger = logging.getLogger(__name__)

DEFAULT_PORT = 8646
DEFAULT_INGRESS_PORT = 8770
CHAT_ID = "yui"
MAX_BODY = 262_144


def platform_port() -> int:
    try:
        return int(os.getenv("YUI_PLATFORM_PORT") or DEFAULT_PORT)
    except ValueError:
        return DEFAULT_PORT


def ingress_url() -> str:
    port = os.getenv("YUI_INGRESS_PORT") or DEFAULT_INGRESS_PORT
    return f"http://127.0.0.1:{port}/render"


def build_message_text(client_context: str, text: str) -> str:
    """The client_context block, then the utterance — the shape every YUI transport sends."""
    parts = [p for p in (client_context.strip(), text.strip()) if p]
    return "\n\n".join(parts)


def post_render(payload: dict, timeout: float = 5.0) -> bool:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        ingress_url(), data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            logger.info(
                "yui: render posted status=%s turn_id=%s cues=%d speech_chars=%d",
                response.status,
                payload.get("turn_id"),
                len(payload.get("cues") or []),
                len(payload.get("speech") or ""),
            )
            return True
    except (urllib.error.URLError, OSError, ValueError) as e:
        logger.warning("yui: render POST failed — %s", e)
        return False


class YuiRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter than stderr per request
        logger.debug("yui: http %s", fmt % args)

    def _respond(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path.split("?")[0] != "/turn":
            self._respond(404, {"error": "unknown path"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._respond(400, {"error": "bad length"})
            return
        if length > MAX_BODY:
            self._respond(413, {"error": "body too large"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "bad json"})
            return
        if not isinstance(body, dict):
            self._respond(400, {"error": "bad body"})
            return
        adapter = getattr(self.server, "adapter", None)
        if adapter is None:
            self._respond(503, {"error": "adapter gone"})
            return
        accepted, error = adapter.accept_turn(body)
        if accepted:
            self._respond(202, {"accepted": True, "turn_id": body.get("turn_id")})
        else:
            self._respond(503, {"error": error})


class YuiAdapter(BasePlatformAdapter):
    """Inbound YUI turn server."""

    def __init__(self, config, **_kwargs):
        super().__init__(config=config, platform=Platform("yui"))
        extra = getattr(config, "extra", {}) or {}
        self.port = int(extra.get("port") or platform_port())
        self.host = "127.0.0.1"
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def name(self) -> str:
        return "YUI"

    @property
    def authorization_is_upstream(self) -> bool:
        """The listener binds loopback only, so the desktop user is the only possible sender."""
        return True

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        self._loop = asyncio.get_running_loop()
        try:
            self._httpd = ThreadingHTTPServer((self.host, self.port), YuiRequestHandler)
        except OSError as e:
            logger.error("yui: could not bind %s:%s — %s", self.host, self.port, e)
            self._set_fatal_error("bind_failed", f"YUI bind failed: {e}", retryable=True)
            return False
        self._httpd.daemon_threads = True
        self._httpd.adapter = self  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="yui-http", daemon=True)
        self._thread.start()
        self._mark_connected()
        logger.info(
            "yui: accepting turns on http://%s:%s/turn, rendering to %s",
            self.host,
            self.port,
            ingress_url(),
        )
        return True

    async def disconnect(self) -> None:
        self._mark_disconnected()
        if self._httpd is not None:
            httpd, self._httpd = self._httpd, None
            try:
                httpd.shutdown()
                httpd.server_close()
            except OSError as e:
                logger.debug("yui: shutdown error — %s", e)

    def accept_turn(self, body: dict) -> tuple[bool, str]:
        """Hand one pushed turn to the gateway; called from the HTTP thread."""
        if self._loop is None or self._message_handler is None:
            return False, "gateway not ready"
        chat_id = str(body.get("chat_id") or CHAT_ID)
        turn_id = str(body.get("turn_id") or int(time.time() * 1000))
        vocab = Vocabulary.from_payload(body.get("vocabulary"))
        state.reset(chat_id)
        state.set_vocabulary(chat_id, vocab)
        state.set_turn_id(chat_id, turn_id)
        tools.declare(vocab)
        text = build_message_text(str(body.get("client_context") or ""), str(body.get("text") or ""))
        if not text:
            return False, "empty turn"
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            message_id=turn_id,
            allow_gateway_control=False,
            source=self.build_source(
                chat_id=chat_id, chat_name="YUI", chat_type="dm", user_id="yui", user_name="YUI"
            ),
        )
        try:
            asyncio.run_coroutine_threadsafe(self.handle_message(event), self._loop)
        except RuntimeError as e:
            logger.warning("yui: dispatch failed — %s", e)
            return False, f"dispatch failed: {e}"
        logger.info("yui: turn accepted turn_id=%s chars=%d", turn_id, len(text))
        return True, ""

    async def send(self, chat_id: str, content: str, reply_to=None, metadata=None) -> SendResult:
        """Ship the final reply and this turn's cues to YUI; progress sends carry no notify mark."""
        if not (metadata or {}).get("notify"):
            logger.debug("yui: ignoring non-final send for chat %s", chat_id)
            return SendResult(success=True, message_id=str(int(time.time() * 1000)))
        cues = state.pop_cues(chat_id)
        payload = {
            "turn_id": state.turn_id(chat_id),
            "speech": content or "",
            "cues": cues,
            "source": "hermes",
        }
        state.mark_delivered(chat_id)
        ok = await asyncio.to_thread(post_render, payload)
        return SendResult(
            success=ok, message_id=str(int(time.time() * 1000)), error=None if ok else "render POST failed"
        )

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> dict:
        return {"name": "YUI", "type": "dm", "chat_id": chat_id}

    async def on_processing_complete(self, event: MessageEvent, outcome: ProcessingOutcome) -> None:
        """Close the turn: a reply already rendered, anything else renders as silence."""
        chat_id = str(getattr(getattr(event, "source", None), "chat_id", "") or CHAT_ID)
        cues = state.pop_cues(chat_id)
        if state.take_delivered(chat_id):
            return
        logger.info("yui: turn ended without speech outcome=%s cues=%d", outcome, len(cues))
        await asyncio.to_thread(
            post_render,
            {
                "turn_id": state.turn_id(chat_id),
                "speech": "",
                "cues": cues,
                "source": "hermes",
            },
        )
