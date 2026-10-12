"""The client-declared tools: registration with Hermes from the hello frame's ``tools``."""

from __future__ import annotations

import json
import logging
from typing import Any

from ..express.tools import TOOLSET
from . import handler

logger = logging.getLogger(__name__)

_ctx: Any = None
_declared: set[str] = set()


def set_context(ctx: Any) -> None:
    global _ctx
    _ctx = ctx


def declare(tools: object, chat_id: str = "") -> None:
    """Register every function tool the client declared, once per schema fingerprint."""
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
        if fingerprint in _declared:
            continue
        _ctx.register_tool(name=name, toolset=TOOLSET, schema=schema, handler=handler.handle(name))
        _declared.add(fingerprint)
        logger.info("yui: client tool declared tool=%s chat=%s", name, chat_id)
