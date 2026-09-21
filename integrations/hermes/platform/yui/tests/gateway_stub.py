"""Minimal stand-ins for the Hermes gateway modules the plugin imports.

Tests run without a gateway process; ``install_stubs`` puts these into ``sys.modules`` before
``yui.src.transport.adapter`` is imported, so the plugin's ``gateway.*`` imports resolve to
recording stubs.
"""

from __future__ import annotations

import os
import re
import sys
import types
from dataclasses import dataclass, field
from enum import Enum

# The stand-in for the gateway's session ContextVars; tests set values directly.
STUB_ENV: dict[str, str] = {}

# An absolute path up to its last character that could not be sentence punctuation.
_BARE_PATH_RE = re.compile(r"/\S*[^\s.,;:!?)]")


class Platform:
    """Stand-in for the Platform enum; plugin platforms are dynamic members anyway."""

    def __init__(self, value: str) -> None:
        self.value = str(value)

    def __repr__(self) -> str:  # pragma: no cover
        return f"Platform({self.value!r})"


class MessageType(Enum):
    TEXT = "text"


class ProcessingOutcome(Enum):
    SUCCESS = "success"
    FAILURE = "failure"
    CANCELLED = "cancelled"


@dataclass
class SessionSource:
    platform: Platform
    chat_id: str
    chat_name: str | None = None
    chat_type: str = "dm"
    user_id: str | None = None
    user_name: str | None = None


@dataclass
class HomeChannel:
    """Stand-in for gateway.config.HomeChannel."""

    platform: Platform
    chat_id: str
    name: str
    thread_id: str | None = None


# What persist_home_channel was asked to write; tests read and clear it.
PERSISTED_HOMES: list[HomeChannel] = []


def persist_home_channel(home: HomeChannel, *, enabled_if_new: bool = False) -> None:
    """The real one writes config.yaml; here the call itself is the observable."""
    PERSISTED_HOMES.append(home)


@dataclass
class MessageEvent:
    text: str
    message_type: MessageType = MessageType.TEXT
    source: SessionSource | None = None
    message_id: str | None = None
    internal: bool = False
    allow_gateway_control: bool = True
    metadata: dict = field(default_factory=dict)
    _gateway_accepted: bool = field(default=False, init=False, repr=False)

    def is_command(self) -> bool:
        return self.allow_gateway_control and (self.text or "").lstrip().startswith("/")

    def get_command(self) -> str | None:
        if not self.is_command():
            return None
        return (self.text or "").lstrip().split(maxsplit=1)[0][1:].lower().split("@", 1)[0]


@dataclass
class SendResult:
    success: bool
    message_id: str | None = None
    error: str | None = None


class BasePlatformAdapter:
    """Records dispatched events instead of running the gateway pipeline."""

    def __init__(self, config=None, platform=None, **_kwargs) -> None:
        self.config = config
        self.platform = platform
        self.dispatched: list[MessageEvent] = []
        self.connected = False
        self.fatal: tuple[str, str] | None = None
        self._message_handler = object()  # truthy: the real base drops events without one
        # The real base holds an interrupt Event per busy session; tests only ask who is in here.
        self._active_sessions: dict[str, object] = {}

    @property
    def name(self) -> str:
        return "stub"

    def build_source(self, chat_id: str, **kwargs) -> SessionSource:
        known = ("chat_name", "chat_type", "user_id", "user_name")
        return SessionSource(
            platform=self.platform or Platform("stub"),
            chat_id=str(chat_id),
            **{k: kwargs[k] for k in known if kwargs.get(k) is not None},
        )

    def _event_session_key(self, event: MessageEvent) -> str:
        """The real base builds ``agent:<ns>:<platform>:<chat_type>:<chat_id>...`` from the source."""
        source = event.source
        platform = getattr(getattr(source, "platform", None), "value", "stub")
        chat_type = getattr(source, "chat_type", "dm")
        return ":".join(("agent:main", platform, chat_type, getattr(source, "chat_id", "") or ""))

    async def handle_message(self, event: MessageEvent) -> None:
        self.dispatched.append(event)
        event._gateway_accepted = True
        if self._event_session_key(event) in self._active_sessions:
            await self._handle_message_while_active(event)

    async def _handle_message_while_active(self, event: MessageEvent) -> None:
        """The real base awaits its busy handler here; tests replace it to fire the event's hooks."""

    def _should_auto_tts_for_chat(self, chat_id: str) -> bool:
        """The real base answers from voice.auto_tts; True here so an override is visible."""
        return True

    @staticmethod
    def extract_media(content: str) -> tuple[list[tuple[str, bool]], str]:
        """The real one pulls ``MEDIA:`` tags out of the text; no test writes one."""
        return [], content

    @staticmethod
    def extract_images(content: str) -> tuple[list[tuple[str, str]], str]:
        """The real one pulls image links out of the text; no test writes one."""
        return [], content

    @staticmethod
    def strip_media_directives_for_display(text: str) -> str:
        """The real one drops the media directives extraction left behind; none are written here."""
        return text

    @staticmethod
    def extract_local_files(content: str) -> tuple[list[str], str]:
        """Absolute paths of files that exist leave the text; the real one also wants a media extension."""
        paths: list[str] = []
        cleaned = content
        for candidate in _BARE_PATH_RE.findall(content):
            if os.path.isfile(candidate) and candidate not in paths:
                paths.append(candidate)
                cleaned = cleaned.replace(candidate, "")
        return paths, cleaned.strip()

    async def _send_media_fallback_notice(
        self, method, kind, path, chat_id, caption=None, reply_to=None, metadata=None, *, file_name=None
    ) -> SendResult:
        """The real base's "couldn't deliver" notice, which reaches the chat as ordinary text."""
        return await self.send(
            chat_id=chat_id,
            content=f"\u26a0\ufe0f Couldn't deliver the {kind} attachment.",
            reply_to=reply_to,
            metadata=metadata,
        )

    async def send_voice(self, chat_id, audio_path, caption=None, reply_to=None, metadata=None, **kwargs):
        return await self._send_media_fallback_notice(
            "send_voice", "audio", audio_path, chat_id, caption, reply_to, metadata
        )

    async def send_document(
        self, chat_id, file_path, caption=None, file_name=None, reply_to=None, metadata=None, **kwargs
    ):
        return await self._send_media_fallback_notice(
            "send_document", "file", file_path, chat_id, caption, reply_to, metadata, file_name=file_name
        )

    async def send_video(self, chat_id, video_path, caption=None, reply_to=None, metadata=None, **kwargs):
        return await self._send_media_fallback_notice(
            "send_video", "video", video_path, chat_id, caption, reply_to, metadata
        )

    async def send_image_file(
        self, chat_id, image_path, caption=None, reply_to=None, metadata=None, **kwargs
    ):
        return await self._send_media_fallback_notice(
            "send_image_file", "image", image_path, chat_id, caption, reply_to, metadata
        )

    async def send_image(self, chat_id, image_url, caption=None, reply_to=None, metadata=None) -> SendResult:
        """The real base falls back to sending the URL as text."""
        return await self.send(chat_id=chat_id, content=image_url, reply_to=reply_to, metadata=metadata)

    async def _send_with_retry(
        self,
        chat_id: str,
        content: str,
        reply_to=None,
        metadata=None,
        max_retries: int = 2,
        base_delay: float = 2.0,
    ) -> SendResult:
        """The gateway's busy path calls this; the real base retries around the same send()."""
        return await self.send(chat_id=chat_id, content=content, reply_to=reply_to, metadata=metadata)

    def _mark_connected(self) -> None:
        self.connected = True

    def _mark_disconnected(self) -> None:
        self.connected = False

    def _set_fatal_error(self, code: str, message: str, *, retryable: bool) -> None:
        self.connected = False
        self.fatal = (code, message)


def get_session_env(name: str, default: str | None = None) -> str | None:
    return STUB_ENV.get(name, default)


class SlashConfirmStub:
    """Stand-in for tools.slash_confirm: records what the adapter registers and resolves."""

    def __init__(self) -> None:
        self.pending: dict[str, dict] = {}
        self.resolved: list[tuple[str, str, str]] = []

    def register(self, session_key: str, confirm_id: str, command: str, handler=None) -> None:
        self.pending[session_key] = {"confirm_id": confirm_id, "command": command}

    def get_pending(self, session_key: str) -> dict | None:
        entry = self.pending.get(session_key)
        return dict(entry) if entry else None

    async def resolve(self, session_key: str, confirm_id: str, choice: str) -> str | None:
        self.resolved.append((session_key, confirm_id, choice))
        self.pending.pop(session_key, None)
        return "✨ New conversation started."


SLASH_CONFIRM = SlashConfirmStub()


def install_stubs() -> None:
    if "gateway.platforms.base" in sys.modules:
        return
    gateway = types.ModuleType("gateway")
    gateway.__path__ = []
    config = types.ModuleType("gateway.config")
    config.Platform = Platform
    config.HomeChannel = HomeChannel
    config.persist_home_channel = persist_home_channel
    platforms = types.ModuleType("gateway.platforms")
    platforms.__path__ = []
    base = types.ModuleType("gateway.platforms.base")
    base.BasePlatformAdapter = BasePlatformAdapter
    base.SendResult = SendResult
    event = types.ModuleType("gateway.platforms.event")
    event.MessageEvent = MessageEvent
    event.MessageType = MessageType
    event.ProcessingOutcome = ProcessingOutcome
    session_context = types.ModuleType("gateway.session_context")
    session_context.get_session_env = get_session_env
    tools = types.ModuleType("tools")
    tools.__path__ = []
    slash_confirm = types.ModuleType("tools.slash_confirm")
    slash_confirm.register = SLASH_CONFIRM.register
    slash_confirm.get_pending = SLASH_CONFIRM.get_pending
    slash_confirm.resolve = SLASH_CONFIRM.resolve
    sys.modules.update(
        {
            "gateway": gateway,
            "gateway.config": config,
            "gateway.platforms": platforms,
            "gateway.platforms.base": base,
            "gateway.platforms.event": event,
            "gateway.session_context": session_context,
            "tools": tools,
            "tools.slash_confirm": slash_confirm,
        }
    )
    tools.slash_confirm = slash_confirm
    gateway.config = config
    gateway.platforms = platforms
    platforms.base = base
    platforms.event = event
