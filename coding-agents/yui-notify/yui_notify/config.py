from __future__ import annotations

import json
import os
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

DEFAULTS = {"endpoint": "http://127.0.0.1:8770"}


def endpoint_error(endpoint: str) -> str | None:
    try:
        url = urlsplit(endpoint)
        if url.scheme == "http" and url.netloc and not (url.path or url.query or url.fragment):
            return None
    except ValueError:
        pass
    return f"invalid endpoint: use http://127.0.0.1:<port> with no path: {endpoint}"


def _dir(env: Mapping[str, str], var: str, fallback: str) -> str:
    return os.path.join(env.get(var) or os.path.expanduser(fallback), "yui-notify")


def load(env: Mapping[str, str]) -> dict:
    cfg = dict(DEFAULTS)
    try:
        with open(os.path.join(_dir(env, "XDG_CONFIG_HOME", "~/.config"), "config.json")) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return cfg
    if not isinstance(data, dict):
        return cfg
    if isinstance(data.get("endpoint"), str) and not endpoint_error(data["endpoint"]):
        cfg["endpoint"] = data["endpoint"]
    return cfg


def state_dir(env: Mapping[str, str]) -> str:
    return _dir(env, "XDG_STATE_HOME", "~/.local/state")


def write_error(env: Mapping[str, str], url: str, status: int | None, error: str | None) -> None:
    record: Any = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "url": url,
        "status": status,
        "error": error,
    }
    try:
        state = state_dir(env)
        os.makedirs(state, exist_ok=True)
        with open(os.path.join(state, "last-error.json"), "w") as f:
            json.dump(record, f)
    except OSError:
        pass
