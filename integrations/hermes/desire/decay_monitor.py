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
        outbox, dropped = desire_state._read_jsonl_locked(outbox_path)
        active = desire_state.active_outbox(outbox, now)
        active_ids = {id(item) for item in active}
        released = [item for item in outbox if id(item) not in active_ids]
        desire_state._write_jsonl_atomic_locked(outbox_path, active)

        for item in released:
            desire_state._append_jsonl_locked(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "outbox_released", "item": item},
            )
        if dropped:
            desire_state._append_jsonl_locked(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "jsonl_lines_dropped", "count": dropped},
            )

        remaining_signals = max(0, 3 - budget["signals"])
        remaining_issues = max(0, 2 - budget["issues"])
        remaining_comments = max(0, 1 - budget["self_comments"])
        return (
            f"social:{desire_state.bucket(levels['social'])} "
            f"curiosity:{desire_state.bucket(levels['curiosity'])} "
            f"accomplishment:{desire_state.bucket(levels['accomplishment'])} "
            f"outbox:{len(active)} "
            f"budget:{remaining_signals}/3sig {remaining_issues}/2iss {remaining_comments}/1cmt\n"
        )


def main() -> None:
    now = datetime.now(desire_state.KST)
    print(run(now), end="")


if __name__ == "__main__":
    main()
