from __future__ import annotations

import json
import os
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

CLASSES = ("urgent", "batched", "drop")
SUMMARY_AGENTS = ("claude-code", "codex")
DEFAULTS = {
    "endpoint": "http://127.0.0.1:8770",
    "events": {"done": "batched", "needs_input": "urgent"},
    "summary": None,
}


def _dir(env: Mapping[str, str], var: str, fallback: str) -> str:
    return os.path.join(env.get(var) or os.path.expanduser(fallback), "yui-notify")


def load(env: Mapping[str, str]) -> dict:
    cfg = {**DEFAULTS, "events": dict(DEFAULTS["events"])}
    try:
        with open(os.path.join(_dir(env, "XDG_CONFIG_HOME", "~/.config"), "config.json")) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return cfg
    if not isinstance(data, dict):
        return cfg
    if isinstance(data.get("endpoint"), str):
        cfg["endpoint"] = data["endpoint"].rstrip("/")
    # summaries are opt-in; only an object turns a per-agent model on
    summary = data.get("summary")
    if isinstance(summary, dict):
        models = {}
        for agent in SUMMARY_AGENTS:
            model = summary.get(agent)
            models[agent] = model if isinstance(model, str) else None
        cfg["summary"] = models
    events = data.get("events")
    for phase in cfg["events"]:
        if isinstance(events, dict) and events.get(phase) in CLASSES:
            cfg["events"][phase] = events[phase]
    return cfg


def write_error(env: Mapping[str, str], url: str, status: int | None, error: str | None) -> None:
    record: Any = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "url": url,
        "status": status,
        "error": error,
    }
    try:
        state = _dir(env, "XDG_STATE_HOME", "~/.local/state")
        os.makedirs(state, exist_ok=True)
        with open(os.path.join(state, "last-error.json"), "w") as f:
            json.dump(record, f)
    except OSError:
        pass
