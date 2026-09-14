"""Minimal stand-ins for the Hermes gateway modules the plugin imports.

Tests run without a gateway process; ``install_stubs`` puts these into ``sys.modules`` before
``yui.adapter`` is imported, so the plugin's ``gateway.*`` imports resolve to recording stubs.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from enum import Enum

# The stand-in for the gateway's session ContextVars; tests set values directly.
STUB_ENV: dict[str, str] = {}


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

    async def handle_message(self, event: MessageEvent) -> None:
        self.dispatched.append(event)
        event._gateway_accepted = True

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
