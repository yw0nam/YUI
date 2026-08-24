import re
from datetime import timedelta
from pathlib import Path

import decay_monitor
import desire_state


def test_monitor_wrapper_is_self_locating_for_symlink_installation():
    wrapper = Path(__file__).parents[1] / "scripts/natsume-desire-monitor.sh"
    assert wrapper.read_text(encoding="utf-8").splitlines() == [
        "#!/bin/sh",
        'exec python3 "$(dirname "$(readlink -f "$0")")/../decay_monitor.py"',
    ]


def test_bootstrap_stdout_is_golden_and_has_one_newline(state_dir, at):
    output = decay_monitor.run(at("2026-08-25T09:00:00+09:00"))
    assert output.encode() == (
        b"social:low curiosity:mid accomplishment:mid outbox:0 budget:3/3sig 2/2iss 1/1cmt\n"
    )
    assert output.endswith("\n")
    assert not output.endswith("\n\n")


def test_normal_stdout_is_golden_and_persists_reanchored_levels(state_dir, at, state_helpers):
    write_json, write_jsonl, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": 25.0, "anchor_at": (now - timedelta(hours=2)).isoformat()},
            "accomplishment": {"level": 71.0, "anchor_at": now.isoformat()},
            "last_interaction_at": (now - timedelta(hours=15)).isoformat(),
            "last_interaction_hash": None,
        },
    )
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 1, "issues": 1, "self_comments": 1, "pending": {}},
    )
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "active",
                "created_at": now.isoformat(),
                "note": "wait",
                "blocked_by": "budget",
                "surfaced_at": None,
            }
        ],
    )

    output = decay_monitor.run(now)

    assert output == "social:high curiosity:low accomplishment:high outbox:1 budget:2/3sig 1/2iss 0/1cmt\n"
    drives = read_json(state_dir / "drives.json")
    assert drives["curiosity"] == {"level": 31.0, "anchor_at": now.isoformat()}
    assert drives["accomplishment"] == {"level": 71.0, "anchor_at": now.isoformat()}


def test_boundary_stdout_bytes(state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": 40.0, "anchor_at": now.isoformat()},
            "accomplishment": {"level": 70.0, "anchor_at": now.isoformat()},
            "last_interaction_at": (now - timedelta(hours=8)).isoformat(),
            "last_interaction_hash": None,
        },
    )
    assert decay_monitor.run(now) == (
        "social:mid curiosity:mid accomplishment:high outbox:0 budget:3/3sig 2/2iss 1/1cmt\n"
    )


def test_level_change_within_bucket_is_stable_but_crossing_changes_stdout(state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    first = at("2026-08-25T09:00:00+09:00")
    desire_state.bootstrap(first)
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": 40.0, "anchor_at": first.isoformat()},
            "accomplishment": {"level": 50.0, "anchor_at": first.isoformat()},
            "last_interaction_at": first.isoformat(),
            "last_interaction_hash": None,
        },
    )
    baseline = decay_monitor.run(first)
    within = decay_monitor.run(first + timedelta(minutes=30))
    crossing = decay_monitor.run(first + timedelta(hours=10))
    assert within == baseline
    assert crossing != within
    assert "curiosity:high" in crossing


def test_used_budget_midnight_reset_changes_stdout(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    before = at("2026-08-25T23:59:59+09:00")
    desire_state.bootstrap(before)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 1, "issues": 1, "self_comments": 1, "pending": {}},
    )
    before_output = decay_monitor.run(before)
    after_output = decay_monitor.run(at("2026-08-26T00:00:00+09:00"))
    assert before_output != after_output
    assert after_output.endswith("budget:3/3sig 2/2iss 1/1cmt\n")
    assert read_json(state_dir / "budget.json")["date"] == "2026-08-26"


def test_untouched_budget_midnight_reset_is_byte_stable(state_dir, at):
    before = at("2026-08-25T23:59:59+09:00")
    desire_state.bootstrap(before)
    assert decay_monitor.run(before) == decay_monitor.run(at("2026-08-26T00:00:00+09:00"))


def test_archive_at_exactly_fifteen_minutes_and_audit(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "expired",
                "created_at": (now - timedelta(hours=1)).isoformat(),
                "note": "old",
                "blocked_by": "budget",
                "surfaced_at": (now - timedelta(minutes=15)).isoformat(),
            },
            {
                "id": "active",
                "created_at": now.isoformat(),
                "note": "new",
                "blocked_by": "error",
                "surfaced_at": (now - timedelta(minutes=14, seconds=59)).isoformat(),
            },
        ],
    )

    decay_monitor.run(now)

    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["active"]
    released = [
        event for event in read_jsonl(state_dir / "audit.jsonl") if event["event"] == "outbox_released"
    ]
    assert released == [{"at": now.isoformat(), "event": "outbox_released", "item": released[0]["item"]}]
    assert released[0]["item"]["id"] == "expired"


def test_monitor_drops_malformed_outbox_lines_and_audits_count(state_dir, at, state_helpers):
    _, _, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    (state_dir / "outbox.jsonl").write_text(
        '{"id":"ok","created_at":"2026-08-25T12:00:00+09:00","note":"n","blocked_by":"budget","surfaced_at":null}\n'
        "{bad}\n",
        encoding="utf-8",
    )

    decay_monitor.run(now)

    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["ok"]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "jsonl_lines_dropped",
        "count": 1,
    }


def test_monitor_reaps_outbox_item_with_invalid_surfaced_at(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "invalid",
                "created_at": now.isoformat(),
                "note": "bad timestamp",
                "blocked_by": "budget",
                "surfaced_at": "not-a-date",
            },
            {
                "id": "valid",
                "created_at": now.isoformat(),
                "note": "keep",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
        ],
    )

    output = decay_monitor.run(now)

    assert output == "social:low curiosity:mid accomplishment:mid outbox:1 budget:3/3sig 2/2iss 1/1cmt\n"
    assert [value["id"] for value in read_jsonl(state_dir / "outbox.jsonl")] == ["valid"]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "jsonl_lines_dropped",
        "count": 1,
    }


def test_monitor_main_emits_valid_fallback_summary_on_unexpected_failure(monkeypatch, capsys):
    def fail(_now):
        raise OSError("state unavailable")

    monkeypatch.setattr(decay_monitor, "run", fail)

    assert decay_monitor.main() is None

    captured = capsys.readouterr()
    assert re.fullmatch(
        r"social:low curiosity:mid accomplishment:mid outbox:0 "
        r"budget:3/3sig 2/2iss 1/1cmt\n",
        captured.out,
    )


def test_monitor_main_falls_back_when_clock_read_fails(monkeypatch, capsys):
    class BrokenClock:
        @classmethod
        def now(cls, _timezone):
            raise OSError("clock unavailable")

    monkeypatch.setattr(decay_monitor, "datetime", BrokenClock)

    assert decay_monitor.main() is None
    assert capsys.readouterr().out == (
        "social:low curiosity:mid accomplishment:mid outbox:0 budget:3/3sig 2/2iss 1/1cmt\n"
    )


def test_monitor_prunes_pending_older_than_seven_days(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {
            "date": "2026-08-25",
            "signals": 0,
            "issues": 2,
            "self_comments": 0,
            "pending": {
                "stale": {"kind": "issue", "date": "2026-08-17"},
                "boundary": {"kind": "issue", "date": "2026-08-18"},
            },
        },
    )

    decay_monitor.run(now)

    assert read_json(state_dir / "budget.json")["pending"] == {
        "boundary": {"kind": "issue", "date": "2026-08-18"}
    }
