from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Mapping
from typing import Any

from yui_notify import config


def tool_input_sha256(tool_input: dict) -> str:
    return hashlib.sha256(json.dumps(tool_input, sort_keys=True).encode()).hexdigest()


def _path(env: Mapping[str, str], session: str) -> str:
    return os.path.join(config.state_dir(env), session + ".json")


def write(
    env: Mapping[str, str], session: str, url: str, body: dict, tool_name: str, tool_input: dict
) -> None:
    # names the open permission ask so the tool's PostToolUse hook can close it after a terminal Yes
    record: Any = {
        "url": url,
        "body": body,
        "ask_id": body["ask"]["ask_id"],
        "tool_name": tool_name,
        "tool_input_sha256": tool_input_sha256(tool_input),
        "written_at": time.time(),
    }
    try:
        os.makedirs(config.state_dir(env), exist_ok=True)
        with open(_path(env, session), "w") as f:
            json.dump(record, f)
    except OSError:
        pass


def _read(env: Mapping[str, str], session: str) -> dict | None:
    try:
        with open(_path(env, session)) as f:
            marker = json.load(f)
    except (OSError, ValueError):
        return None
    return marker if isinstance(marker, dict) else None


def matching(env: Mapping[str, str], session: str, tool_name: str, tool_input: dict) -> dict | None:
    marker = _read(env, session)
    if (
        marker
        and isinstance(marker.get("url"), str)
        and isinstance(marker.get("body"), dict)
        and marker.get("tool_name") == tool_name
        and marker.get("tool_input_sha256") == tool_input_sha256(tool_input)
    ):
        return marker
    return None


def remove_if_own(env: Mapping[str, str], session: str, ask_id: str) -> None:
    marker = _read(env, session)
    if marker and marker.get("ask_id") == ask_id:
        remove(env, session)


def remove(env: Mapping[str, str], session: str) -> None:
    try:
        os.remove(_path(env, session))
    except OSError:
        pass
