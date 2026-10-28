"""The client-declared tools: registration with Hermes from the hello frame's ``tools``.

Hermes keeps one schema per tool name, so a tool whose schema differs per client is registered
again with the chat's own schema when that chat's turn starts, the way ``generate_express`` is.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..express.tools import TOOLSET
from . import handler

logger = logging.getLogger(__name__)

_ctx: Any = None
_declared: dict[str, str] = {}


def set_context(ctx: Any) -> None:
    global _ctx
    _ctx = ctx


def declare(tools: object, chat_id: str = "") -> None:
    """Register every function tool the client declared; a name whose schema changed is registered again."""
    if _ctx is None or not isinstance(tools, list):
        return
    for entry in tools:
        if not isinstance(entry, dict) or entry.get("type") != "function":
            continue
        function = entry.get("function")
        if not isinstance(function, dict):
            continue
        name = str(function.get("name") or "").strip()
        if not name:
            continue
        schema = {
            "description": str(function.get("description") or ""),
            "parameters": function["parameters"] if isinstance(function.get("parameters"), dict) else {},
        }
        fingerprint = json.dumps({"name": name, **schema}, sort_keys=True, ensure_ascii=False)
        if _declared.get(name) == fingerprint:
            continue
        _ctx.register_tool(name=name, toolset=TOOLSET, schema=schema, handler=handler.handle(name))
        _declared[name] = fingerprint
        logger.info("yui: client tool declared tool=%s chat=%s", name, chat_id)
