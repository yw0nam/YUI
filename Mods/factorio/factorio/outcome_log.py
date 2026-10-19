"""Append one JSON line per polled event, doorbell post, recovery, and tool call."""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class OutcomeLog:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, record: dict[str, Any]) -> None:
        stamped = {"ts": datetime.now(UTC).isoformat(timespec="milliseconds"), **record}
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(stamped, ensure_ascii=False) + "\n")

    def event(self, event: dict) -> None:
        self.write({"type": "event", "event": event})

    def doorbell(
        self,
        *,
        status: int | None,
        pending_from_seq: int,
        pending_to_seq: int,
        reset: bool,
        error: str | None = None,
    ) -> None:
        record = {
            "type": "doorbell",
            "status": status,
            "pending_from_seq": pending_from_seq,
            "pending_to_seq": pending_to_seq,
            "reset": reset,
        }
        if error is not None:
            record["error"] = error
        self.write(record)

    def history_gap(self, *, oldest_seq: int) -> None:
        self.write({"type": "history_gap", "oldest_seq": oldest_seq})

    def session_reset(self, *, cause: str, poll_cursor: int, backend_cursor: int) -> None:
        self.write(
            {
                "type": "session_reset",
                "cause": cause,
                "poll_cursor": poll_cursor,
                "backend_cursor": backend_cursor,
            }
        )

    def backend_lag(self, *, dropped: int) -> None:
        self.write({"type": "backend_lag", "dropped": dropped})

    def tool(self, *, tool: str, args: dict, ok: bool, error: str | None = None) -> None:
        record = {
            "type": "tool",
            "tool": tool,
            "args_hash": hashlib.sha256(
                json.dumps(args, sort_keys=True, ensure_ascii=False, default=str).encode()
            ).hexdigest(),
            "ok": ok,
        }
        if error is not None:
            record["error"] = error
        self.write(record)
