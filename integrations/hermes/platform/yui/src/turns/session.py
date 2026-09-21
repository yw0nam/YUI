"""Which chat the gateway is currently running a turn for."""

from __future__ import annotations

from . import state


def current_chat_id() -> str:
    """The chat of the turn in flight; with the context empty, the sole connected client."""
    from gateway.session_context import get_session_env

    chat_id = str(get_session_env("HERMES_SESSION_CHAT_ID") or "").strip()
    if chat_id:
        return chat_id
    connected = state.connected_chats()
    return connected[0] if len(connected) == 1 else ""
