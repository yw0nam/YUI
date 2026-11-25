from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping
from typing import Any

from yui_notify import config
from yui_notify.threads.client import put


def tool_input_sha256(tool_input: dict) -> str:
    return hashlib.sha256(json.dumps(tool_input, sort_keys=True).encode()).hexdigest()


def _path(env: Mapping[str, str], session: str) -> str:
    return os.path.join(config.state_dir(env), session + ".permission.json")


def write(
    env: Mapping[str, str], session: str, url: str, body: dict, tool_name: str, tool_input: dict
) -> None:
    # names the pending permission Thread so the tool's PostToolUse hook can return it to working
    record: Any = {
        "url": url,
        "body": body,
        "tool_name": tool_name,
        "tool_input_sha256": tool_input_sha256(tool_input),
    }
    try:
        os.makedirs(config.state_dir(env), exist_ok=True)
        # the marker holds the command text, so it is readable by its owner only
        fd = os.open(_path(env, session), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
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


def close(env: Mapping[str, str], session: str, tool_name: str, tool_input: dict) -> None:
    # the allowed tool runs and Claude Code fires PostToolUse: its Thread returns to working
    marker = matching(env, session, tool_name, tool_input)
    if not marker:
        return
    url = marker["url"]
    working = {**marker["body"], "state": "working", "entries": []}
    status, _, error = put(url, working)
    if error:
        config.write_error(env, url, status, error)
    remove(env, session)


def remove(env: Mapping[str, str], session: str) -> None:
    try:
        os.remove(_path(env, session))
    except OSError:
        pass
