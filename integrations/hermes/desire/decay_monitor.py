"""Persist desire drive decay/growth and emit Hermes' hash-gated summary."""

from __future__ import annotations

import os
import socket
from datetime import datetime, timedelta
from urllib.parse import urlsplit

import desire_state


def probe_transport() -> bool:
    """Report whether the YUI signals ingress accepts a TCP connection right now."""

    target = urlsplit(os.environ.get("YUI_SIGNALS_URL", desire_state.DEFAULT_SIGNALS_URL))
    if not target.hostname:
        return False
    try:
        port = target.port or (443 if target.scheme == "https" else 80)
        with socket.create_connection((target.hostname, port), timeout=2):
            return True
    except (OSError, ValueError):
        return False


def run(now: datetime) -> str:
    now = desire_state.normalize_now(now)
    reachable = probe_transport()
    with desire_state.state_lock() as state_dir:
        state = desire_state.bootstrap_locked(state_dir, now)

        drives = state["drives"]
        levels = desire_state.drive_levels(drives, now)
        for name in ("curiosity", "accomplishment"):
            drives[name] = {"level": levels[name], "anchor_at": now.isoformat()}
        desire_state.write_json_atomic(state_dir / "drives.json", drives)

        budget = desire_state.normalize_budget(state["budget"], now)
        cutoff = now.date() - timedelta(days=7)
        budget["pending"] = {
            reservation_id: reservation
            for reservation_id, reservation in budget["pending"].items()
            if not desire_state.reservation_is_older_than(reservation, cutoff)
        }
        desire_state.write_json_atomic(state_dir / "budget.json", budget)

        outbox_path = state_dir / "outbox.jsonl"
        outbox, dropped = desire_state.read_jsonl_with_dropped(outbox_path)
        valid = [item for item in outbox if desire_state.valid_outbox_item(item)]
        dropped += len(outbox) - len(valid)
        active = desire_state.active_outbox(valid, now)
        active_ids = {id(item) for item in active}
        expired = [item for item in valid if id(item) not in active_ids]
        desire_state.write_jsonl_atomic(outbox_path, active)

        for item in expired:
            desire_state.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "outbox_expired", "item": item},
            )
        if dropped:
            desire_state.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "jsonl_lines_dropped", "count": dropped},
            )

        transport = desire_state.record_transport(state_dir, reachable, now)
        outbox_summary = str(len(active))
        if active:
            oldest = min(desire_state.parse_timestamp(item["created_at"]) for item in active)
            outbox_summary += f"/{desire_state.pent_up_stage(oldest, now)}"

        remaining_signals = max(0, desire_state.CAPS["signals"] - budget["signals"])
        remaining_issues = max(0, desire_state.CAPS["issues"] - budget["issues"])
        remaining_comments = max(0, desire_state.CAPS["self_comments"] - budget["self_comments"])
        return (
            f"social:{desire_state.bucket(levels['social'])} "
            f"curiosity:{desire_state.bucket(levels['curiosity'])} "
            f"accomplishment:{desire_state.bucket(levels['accomplishment'])} "
            f"outbox:{outbox_summary} "
            f"transport:{transport['state']} "
            f"budget:{remaining_signals}/3sig {remaining_issues}/2iss {remaining_comments}/1cmt\n"
        )


def main() -> None:
    try:
        now = datetime.now(desire_state.KST)
        summary = run(now)
    except Exception:  # noqa: BLE001 - the hash-gated cron must always receive a valid summary
        summary = "social:low curiosity:mid accomplishment:mid outbox:0 transport:down budget:3/3sig 2/2iss 1/1cmt\n"
    print(summary, end="")


if __name__ == "__main__":
    main()
