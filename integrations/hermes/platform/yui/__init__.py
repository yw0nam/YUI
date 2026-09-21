"""YUI platform plugin: the client WebSocket, the cue tool, and the delegation hooks."""

from __future__ import annotations

import importlib.util
import logging
import os

logger = logging.getLogger(__name__)

__all__ = ["register"]

_PLATFORM_HINT = (
    "You are speaking through YUI, an on-screen VRM character. Each turn arrives as a "
    "<client_context> block followed by the user's words; the block is client-injected context, "
    "not something the user typed. Reply with the words to say out loud — no markdown, no lists, "
    "no stage directions. Call generate_express once per reply to place facial expression, body "
    "motion and voice-tone cues on the sentences you are about to speak; never write expression "
    "cues into the speech itself. The user hears nothing while a turn runs, so when a delegation "
    "tool is available, work that needs more than a few tool calls and can run on its own goes to a "
    "background delegation even when you could do it yourself in this turn: delegate it, say in one "
    "sentence what you started, and end the turn. The user can keep talking, and the result comes "
    "back for you to report when it finishes. Reply with [SILENT] when the turn does not deserve a "
    "spoken answer."
)


def check_requirements() -> bool:
    """The socket server needs aiohttp; the probe stays passive."""
    return importlib.util.find_spec("aiohttp") is not None


def validate_config(config) -> bool:
    """Host and port have defaults; nothing is required."""
    return True


def is_connected(config) -> bool:
    """Configured when the platform block enables it or a key is set in the environment."""
    extra = getattr(config, "extra", {}) or {}
    return bool(extra.get("enabled")) or bool(os.getenv("YUI_PLATFORM_KEY"))


def register(ctx) -> None:
    from . import delegations, reasoning, speech, tool_status, tools
    from .gate import Vocabulary

    tools.set_context(ctx)
    try:
        tools.declare(Vocabulary())
    except Exception:
        logger.warning("YUI: failed to declare generate_express", exc_info=True)
    for hook, callback in (
        ("subagent_start", delegations.on_subagent_start),
        ("subagent_stop", delegations.on_subagent_stop),
        ("on_stream_delta", reasoning.on_stream_delta),
        ("on_stream_delta", speech.on_stream_delta),
        ("pre_tool_call", tool_status.on_pre_tool_call),
        ("post_tool_call", tool_status.on_post_tool_call),
    ):
        try:
            ctx.register_hook(hook, callback)
        except Exception:
            logger.warning("YUI: failed to register the %s hook", hook, exc_info=True)
    try:
        from .adapter import YuiAdapter

        ctx.register_platform(
            name="yui",
            label="YUI",
            adapter_factory=lambda cfg: YuiAdapter(cfg),
            check_fn=check_requirements,
            validate_config=validate_config,
            is_connected=is_connected,
            required_env=[],
            install_hint="Needs aiohttp (pip install aiohttp)",
            emoji="\U0001f9cd",
            allow_update_command=False,
            platform_hint=_PLATFORM_HINT,
        )
    except Exception:
        logger.warning("YUI: failed to register platform adapter", exc_info=True)
