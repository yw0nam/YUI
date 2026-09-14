"""YUI platform plugin: the inbound pushed-turn channel and the generate_express cue tool."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

__all__ = ["register"]

_PLATFORM_HINT = (
    "You are speaking through YUI, an on-screen VRM character. Each turn arrives as a "
    "<client_context> block followed by the user's words; the block is client-injected context, "
    "not something the user typed. Reply with the words to say out loud — no markdown, no lists, "
    "no stage directions. Call generate_express to place a facial expression, body motion or "
    "voice-tone cue on the speech; never write expression cues into the speech itself. Reply with "
    "[SILENT] when the turn does not deserve a spoken answer."
)


def check_requirements() -> bool:
    """Stdlib only, loopback only."""
    return True


def validate_config(config) -> bool:
    """Ports have safe defaults; nothing is required."""
    return True


def is_connected(config) -> bool:
    """Configured when the platform block enables it or a port is set in the environment."""
    extra = getattr(config, "extra", {}) or {}
    return bool(extra.get("enabled")) or bool(os.getenv("YUI_PLATFORM_PORT"))


def register(ctx) -> None:
    from . import tools
    from .gate import Vocabulary

    tools.set_context(ctx)
    try:
        tools.declare(Vocabulary())
    except Exception:
        logger.warning("YUI: failed to declare generate_express", exc_info=True)
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
            install_hint="No extra packages needed (stdlib only)",
            emoji="\U0001f9cd",
            allow_update_command=False,
            platform_hint=_PLATFORM_HINT,
        )
    except Exception:
        logger.warning("YUI: failed to register platform adapter", exc_info=True)
