"""Persist desire drive decay/growth and emit Hermes' hash-gated summary."""

from __future__ import annotations

from datetime import datetime, timedelta

import desire_state


def run(now: datetime) -> str:
    now = desire_state.normalize_now(now)
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
        released = [item for item in valid if id(item) not in active_ids]
        desire_state.write_jsonl_atomic(outbox_path, active)

        for item in released:
            desire_state.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "outbox_released", "item": item},
            )
        if dropped:
            desire_state.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "jsonl_lines_dropped", "count": dropped},
            )

        remaining_signals = max(0, desire_state.CAPS["signals"] - budget["signals"])
        remaining_issues = max(0, desire_state.CAPS["issues"] - budget["issues"])
        remaining_comments = max(0, desire_state.CAPS["self_comments"] - budget["self_comments"])
        return (
            f"social:{desire_state.bucket(levels['social'])} "
            f"curiosity:{desire_state.bucket(levels['curiosity'])} "
            f"accomplishment:{desire_state.bucket(levels['accomplishment'])} "
            f"outbox:{len(active)} "
            f"budget:{remaining_signals}/3sig {remaining_issues}/2iss {remaining_comments}/1cmt\n"
        )


def main() -> None:
    try:
        now = datetime.now(desire_state.KST)
        summary = run(now)
    except Exception:  # noqa: BLE001 - the hash-gated cron must always receive a valid summary
        summary = "social:low curiosity:mid accomplishment:mid outbox:0 budget:3/3sig 2/2iss 1/1cmt\n"
    print(summary, end="")


if __name__ == "__main__":
    main()
