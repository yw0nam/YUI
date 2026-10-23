from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from yui_notify.adapters import Event
from yui_notify.label import make_label


def build_signal(event: Event, ctx: Mapping[str, Any], delivery: str, summary: str, now_ms: int) -> dict:
    item = {k: ctx[k] for k in ("project", "branch", "host", "tmux")}
    if event.phase == "done":
        item["summary"] = summary
    else:
        item["pending"] = event.text
    return {
        "signals": [item],
        "envelope": {
            "source": event.agent,
            "event_type": f"agent.{event.phase}",
            "delivery": delivery,
            "event_id": f"{event.session_id}:{event.phase}",
            "label": make_label(ctx),
            "occurred_at": now_ms,
        },
    }
