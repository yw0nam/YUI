import json
import re
import socket
import threading
from datetime import timedelta
from pathlib import Path

import pytest
from conftest import AGENT_NAME, PROFILE_NAME

import decay_monitor
import desire_state

BRANCH = f"{AGENT_NAME}/"
MARKER = f"<!-- from-{AGENT_NAME} -->"


def without_day(summary: str) -> str:
    return re.sub(r" day:\d{4}-\d{2}-\d{2}", "", summary)


def without_starved(summary: str) -> str:
    return re.sub(r" starved:\d+/\d+/\d+", "", summary)


def test_monitor_wrapper_is_self_locating_for_symlink_installation():
    wrapper = Path(__file__).parents[1] / "scripts/desire-monitor.sh"
    assert wrapper.read_text(encoding="utf-8").splitlines() == [
        "#!/bin/sh",
        'exec python3 "$(dirname "$(readlink -f "$0")")/../decay_monitor.py"',
    ]


@pytest.mark.parametrize("missing", ["DESIRE_AGENT_NAME", "HERMES_PROFILE"])
def test_monitor_refuses_to_run_without_its_identity(state_dir, monkeypatch, capsys, missing):
    monkeypatch.delenv(missing, raising=False)

    with pytest.raises(SystemExit) as failure:
        decay_monitor.main()

    assert missing in str(failure.value)
    assert capsys.readouterr().out == ""


def test_bootstrap_stdout_is_golden_and_has_one_newline(state_dir, at):
    output = decay_monitor.run(at("2026-08-25T09:00:00+09:00"))
    assert output.encode() == (
        b"social:low curiosity:mid accomplishment:mid outbox:0 transport:down "
        b"budget:3/3sig 2/2iss 1/1cmt 1/1pr day:2026-08-25 rises:0 starved:0/0/0\n"
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
        {"date": "2026-08-25", "signals": 1, "issues": 1, "self_comments": 1, "prs": 0, "pending": {}},
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

    assert (
        output == "social:high curiosity:mid accomplishment:high outbox:1/fresh transport:down "
        "budget:2/3sig 1/2iss 0/1cmt 1/1pr day:2026-08-25 rises:2 starved:0/0/0\n"
    )
    drives = read_json(state_dir / "drives.json")
    assert drives["curiosity"] == {"level": 43.0, "anchor_at": now.isoformat()}
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
            "last_interaction_at": (now - timedelta(hours=3)).isoformat(),
            "last_interaction_hash": None,
        },
    )
    assert decay_monitor.run(now) == (
        "social:mid curiosity:mid accomplishment:high outbox:0 transport:down "
        "budget:3/3sig 2/2iss 1/1cmt 1/1pr day:2026-08-25 rises:2 starved:0/0/0\n"
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


def write_drives(write_json, state_dir, now, *, curiosity, accomplishment, social_hours=0):
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": curiosity, "anchor_at": now.isoformat()},
            "accomplishment": {"level": accomplishment, "anchor_at": now.isoformat()},
            "last_interaction_at": (now - timedelta(hours=social_hours)).isoformat(),
            "last_interaction_hash": None,
        },
    )


def test_a_falling_drive_bucket_leaves_the_summary_byte_identical(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_drives(write_json, state_dir, now, curiosity=75.0, accomplishment=50.0)

    high = decay_monitor.run(now)
    risen = read_json(state_dir / "monitor.json")["rises"]
    write_drives(write_json, state_dir, now, curiosity=45.0, accomplishment=50.0)
    fallen = decay_monitor.run(now)

    assert "curiosity:high" in high
    assert fallen.encode() == high.encode()
    monitor = read_json(state_dir / "monitor.json")
    assert monitor["rises"] == risen
    assert monitor["latched"]["curiosity"] == "high"


def test_a_drive_rising_again_after_a_fall_changes_the_summary(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_drives(write_json, state_dir, now, curiosity=75.0, accomplishment=50.0)

    high = decay_monitor.run(now)
    risen = read_json(state_dir / "monitor.json")["rises"]
    write_drives(write_json, state_dir, now, curiosity=45.0, accomplishment=50.0)
    fallen = decay_monitor.run(now)
    write_drives(write_json, state_dir, now, curiosity=75.0, accomplishment=50.0)
    again = decay_monitor.run(now)

    assert fallen == high
    assert again != fallen
    monitor = read_json(state_dir / "monitor.json")
    assert monitor["rises"] == risen + 1
    assert monitor["latched"]["curiosity"] == "high"


def test_a_rise_reprints_a_fallen_drive_at_its_current_bucket(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_drives(write_json, state_dir, now, curiosity=75.0, accomplishment=50.0, social_hours=1)
    decay_monitor.run(now)
    risen = read_json(state_dir / "monitor.json")["rises"]

    write_drives(write_json, state_dir, now, curiosity=20.0, accomplishment=50.0, social_hours=5)
    output = decay_monitor.run(now)

    assert output.startswith("social:high curiosity:low accomplishment:mid ")
    monitor = read_json(state_dir / "monitor.json")
    assert monitor["rises"] == risen + 1
    assert monitor["latched"] == {"social": "high", "curiosity": "low", "accomplishment": "mid"}


def test_a_drive_held_at_the_ceiling_starves_every_three_hours(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    start = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(start)
    write_drives(write_json, state_dir, start, curiosity=100.0, accomplishment=50.0)

    assert decay_monitor.run(start).endswith(" starved:0/0/0\n")

    assert read_json(state_dir / "monitor.json")["saturated_since"] == {
        "social": None,
        "curiosity": start.isoformat(),
        "accomplishment": None,
    }
    assert decay_monitor.run(start + timedelta(hours=2, minutes=59)).endswith(" starved:0/0/0\n")
    assert decay_monitor.run(start + timedelta(hours=3)).endswith(" starved:0/1/0\n")
    assert decay_monitor.run(start + timedelta(hours=6)).endswith(" starved:0/2/0\n")


def test_the_summary_changes_at_the_three_hour_saturation_boundary(state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    start = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(start)
    write_drives(write_json, state_dir, start, curiosity=100.0, accomplishment=50.0)
    decay_monitor.run(start)

    before = decay_monitor.run(start + timedelta(hours=2, minutes=59, seconds=59))
    crossing = decay_monitor.run(start + timedelta(hours=3))

    assert crossing != before
    assert crossing == before.replace(" starved:0/0/0", " starved:0/1/0")


def test_two_saturated_drives_starve_together(state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    start = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(start)
    write_drives(write_json, state_dir, start, curiosity=100.0, accomplishment=100.0)
    decay_monitor.run(start)

    assert decay_monitor.run(start + timedelta(hours=3)).endswith(" starved:0/1/1\n")


def test_satisfying_a_saturated_drive_clears_its_saturation(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    start = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(start)
    write_drives(write_json, state_dir, start, curiosity=100.0, accomplishment=50.0)
    decay_monitor.run(start)
    later = start + timedelta(hours=3)
    assert decay_monitor.run(later).endswith(" starved:0/1/0\n")

    desire_state.satisfy("learned", "read the paper", later)

    assert read_json(state_dir / "drives.json")["curiosity"]["level"] == 70.0
    assert decay_monitor.run(later).endswith(" starved:0/0/0\n")
    assert read_json(state_dir / "monitor.json")["saturated_since"]["curiosity"] is None


def test_one_drive_leaving_the_ceiling_cannot_hide_another_crossing(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    start = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(start)
    write_drives(write_json, state_dir, start, curiosity=100.0, accomplishment=100.0)
    decay_monitor.run(start)
    both_saturated = decay_monitor.run(start + timedelta(hours=3))

    later = start + timedelta(hours=6)
    desire_state.satisfy("shipped", "landed the pull request", later)
    drives = read_json(state_dir / "drives.json")
    drives["last_interaction_at"] = (start + timedelta(hours=3)).isoformat()
    write_json(state_dir / "drives.json", drives)
    one_satisfied = decay_monitor.run(later)

    assert both_saturated.endswith(" starved:0/1/1\n")
    assert one_satisfied.endswith(" starved:0/2/0\n")
    assert without_starved(one_satisfied) == without_starved(both_saturated)
    assert one_satisfied != both_saturated


def test_monitor_state_without_saturation_is_read_as_unsaturated(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T09:00:00+09:00")
    desire_state.bootstrap(now)
    buckets = {"social": "low", "curiosity": "mid", "accomplishment": "mid"}
    write_json(state_dir / "monitor.json", {"latched": buckets, "natural": buckets, "rises": 0})

    assert decay_monitor.run(now).endswith(" rises:0 starved:0/0/0\n")

    assert read_json(state_dir / "monitor.json")["saturated_since"] == {
        "social": None,
        "curiosity": None,
        "accomplishment": None,
    }
    assert list(state_dir.glob("monitor.json.corrupt-*")) == []


def test_bootstrap_latches_the_current_buckets(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_drives(write_json, state_dir, now, curiosity=80.0, accomplishment=20.0, social_hours=5)
    (state_dir / "monitor.json").unlink()

    output = decay_monitor.run(now)

    buckets = {"social": "high", "curiosity": "high", "accomplishment": "low"}
    assert read_json(state_dir / "monitor.json") == {
        "latched": buckets,
        "natural": buckets,
        "rises": 0,
        "saturated_since": {"social": None, "curiosity": None, "accomplishment": None},
    }
    assert output.startswith("social:high curiosity:high accomplishment:low ")
    assert output.endswith(" rises:0 starved:0/0/0\n")


@pytest.mark.parametrize("rises", [-1, True, "3"])
def test_invalid_rise_count_is_quarantined_and_rebuilt(state_dir, at, state_helpers, rises):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T09:00:00+09:00")
    desire_state.bootstrap(now)
    buckets = {"social": "low", "curiosity": "mid", "accomplishment": "mid"}
    write_json(state_dir / "monitor.json", {"latched": buckets, "natural": buckets, "rises": rises})

    assert decay_monitor.run(now).endswith(" rises:0 starved:0/0/0\n")

    assert read_json(state_dir / "monitor.json")["rises"] == 0
    assert len(list(state_dir.glob("monitor.json.corrupt-*"))) == 1


def test_corrupt_monitor_state_is_quarantined_and_rebuilt(state_dir, at, state_helpers):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T09:00:00+09:00")
    desire_state.bootstrap(now)
    (state_dir / "monitor.json").write_text("{broken", encoding="utf-8")

    assert decay_monitor.run(now).endswith(" rises:0 starved:0/0/0\n")

    buckets = {"social": "low", "curiosity": "mid", "accomplishment": "mid"}
    assert read_json(state_dir / "monitor.json") == {
        "latched": buckets,
        "natural": buckets,
        "rises": 0,
        "saturated_since": {"social": None, "curiosity": None, "accomplishment": None},
    }
    assert len(list(state_dir.glob("monitor.json.corrupt-20260825090000"))) == 1
    assert any(
        event["event"] == "state_corrupt_recovered" and event["file"] == "monitor.json"
        for event in read_jsonl(state_dir / "audit.jsonl")
    )

    write_json(state_dir / "monitor.json", {"latched": {"social": "sideways"}, "rises": 0})

    assert decay_monitor.run(now + timedelta(minutes=1)).endswith(" rises:0 starved:0/0/0\n")

    assert read_json(state_dir / "monitor.json")["latched"] == buckets

    write_json(
        state_dir / "monitor.json",
        {"latched": buckets, "natural": buckets, "rises": 0, "saturated_since": {"social": "noon"}},
    )

    assert decay_monitor.run(now + timedelta(minutes=2)).endswith(" rises:0 starved:0/0/0\n")

    assert read_json(state_dir / "monitor.json")["saturated_since"] == {
        "social": None,
        "curiosity": None,
        "accomplishment": None,
    }
    assert len(list(state_dir.glob("monitor.json.corrupt-*"))) == 3


def test_every_run_appends_one_tick_line(state_dir, at, state_helpers):
    write_json, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_drives(write_json, state_dir, now, curiosity=33.333333, accomplishment=55.0, social_hours=2)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "held",
                "created_at": now.isoformat(),
                "note": "wait",
                "blocked_by": "budget",
                "surfaced_at": None,
            }
        ],
    )

    decay_monitor.run(now)
    later = now + timedelta(hours=1)
    output = decay_monitor.run(later)

    assert read_jsonl(state_dir / "ticks.jsonl") == [
        {
            "at": now.isoformat(),
            "social": 30.0,
            "curiosity": 33.3,
            "accomplishment": 55.0,
            "transport": "down",
            "outbox": 1,
            "last_interaction_at": (now - timedelta(hours=2)).isoformat(),
        },
        {
            "at": later.isoformat(),
            "social": 45.0,
            "curiosity": 42.3,
            "accomplishment": 61.0,
            "transport": "down",
            "outbox": 1,
            "last_interaction_at": (now - timedelta(hours=2)).isoformat(),
        },
    ]
    assert "ticks" not in output


def test_used_budget_midnight_reset_changes_stdout(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    before = at("2026-08-25T23:59:59+09:00")
    desire_state.bootstrap(before)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 1, "issues": 1, "self_comments": 1, "prs": 0, "pending": {}},
    )
    before_output = decay_monitor.run(before)
    after_output = decay_monitor.run(at("2026-08-26T00:00:00+09:00"))
    assert before_output != after_output
    assert after_output.endswith("budget:3/3sig 2/2iss 1/1cmt 1/1pr day:2026-08-25 rises:0 starved:0/0/0\n")
    assert read_json(state_dir / "budget.json")["date"] == "2026-08-26"


def test_untouched_budget_midnight_reset_is_byte_stable(state_dir, at):
    before = at("2026-08-25T23:59:59+09:00")
    desire_state.bootstrap(before)
    assert decay_monitor.run(before) == decay_monitor.run(at("2026-08-26T00:00:00+09:00"))


def test_monitor_expires_items_at_48h_and_audits(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "expired",
                "created_at": (now - timedelta(hours=48)).isoformat(),
                "note": "old",
                "blocked_by": "budget",
                "surfaced_at": (now - timedelta(hours=40)).isoformat(),
            },
            {
                "id": "active",
                "created_at": (now - timedelta(hours=47, minutes=59)).isoformat(),
                "note": "new",
                "blocked_by": "error",
                "surfaced_at": (now - timedelta(hours=1)).isoformat(),
            },
        ],
    )

    decay_monitor.run(now)

    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["active"]
    expired = [event for event in read_jsonl(state_dir / "audit.jsonl") if event["event"] == "outbox_expired"]
    assert expired == [{"at": now.isoformat(), "event": "outbox_expired", "item": expired[0]["item"]}]
    assert expired[0]["item"]["id"] == "expired"


def test_monitor_keeps_surfaced_item_alive_past_fifteen_minutes(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "fresh",
                "created_at": now.isoformat(),
                "note": "still pending",
                "blocked_by": "budget",
                "surfaced_at": (now - timedelta(minutes=20)).isoformat(),
            }
        ],
    )

    decay_monitor.run(now)

    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["fresh"]


def test_monitor_removes_future_dated_item_without_raising_and_audits_expired(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "far_future",
                "created_at": "9999-12-31T23:59:59+09:00",
                "note": "distant",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
            {
                "id": "near_future",
                "created_at": (now + timedelta(hours=1)).isoformat(),
                "note": "not yet",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
        ],
    )

    decay_monitor.run(now)

    assert read_jsonl(state_dir / "outbox.jsonl") == []
    expired_ids = {
        event["item"]["id"]
        for event in read_jsonl(state_dir / "audit.jsonl")
        if event["event"] == "outbox_expired"
    }
    assert expired_ids == {"far_future", "near_future"}


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

    assert output == (
        "social:low curiosity:mid accomplishment:mid outbox:1/fresh transport:down "
        "budget:3/3sig 2/2iss 1/1cmt 1/1pr day:2026-08-25 rises:0 starved:0/0/0\n"
    )
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
        r"social:low curiosity:mid accomplishment:mid outbox:0 transport:down "
        r"budget:3/3sig 2/2iss 1/1cmt 1/1pr day:\d{4}-\d{2}-\d{2} rises:0 starved:0/0/0\n",
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
        "social:low curiosity:mid accomplishment:mid outbox:0 transport:down "
        "budget:3/3sig 2/2iss 1/1cmt 1/1pr day:unknown rises:0 starved:0/0/0\n"
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
            "prs": 0,
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


def test_transport_probe_flips_stdout_and_tracks_since_and_failures(
    state_dir, at, state_helpers, listening_signals_url, closed_signals_url, monkeypatch
):
    _, _, read_json, _ = state_helpers
    first = at("2026-08-25T12:00:00+09:00")

    up = decay_monitor.run(first)

    assert "transport:up " in up
    assert read_json(state_dir / "transport.json") == {
        "state": "up",
        "since": first.isoformat(),
        "failed": 0,
        "last_checked_at": first.isoformat(),
        "source": "probe",
    }

    monkeypatch.setenv("YUI_SIGNALS_URL", closed_signals_url)
    second = first + timedelta(minutes=30)
    down = decay_monitor.run(second)
    assert down != up
    assert "transport:down " in down
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": second.isoformat(),
        "failed": 1,
        "last_checked_at": second.isoformat(),
        "source": "probe",
    }

    third = second + timedelta(minutes=30)
    assert decay_monitor.run(third) == down
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": second.isoformat(),
        "failed": 2,
        "last_checked_at": third.isoformat(),
        "source": "probe",
    }

    monkeypatch.setenv("YUI_SIGNALS_URL", listening_signals_url)
    fourth = third + timedelta(minutes=30)
    assert decay_monitor.run(fourth) == up
    assert read_json(state_dir / "transport.json") == {
        "state": "up",
        "since": fourth.isoformat(),
        "failed": 0,
        "last_checked_at": fourth.isoformat(),
        "source": "probe",
    }


def test_pent_up_stage_changes_stdout_exactly_at_hour_boundaries(state_dir, at, state_helpers):
    write_json, write_jsonl, _, _ = state_helpers
    created = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(created)
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": 100.0, "anchor_at": created.isoformat()},
            "accomplishment": {"level": 100.0, "anchor_at": created.isoformat()},
            "last_interaction_at": (created - timedelta(hours=10)).isoformat(),
            "last_interaction_hash": None,
        },
    )
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "note",
                "created_at": created.isoformat(),
                "note": "wait",
                "blocked_by": "error",
                "surfaced_at": None,
            }
        ],
    )

    fresh = decay_monitor.run(created)
    assert " outbox:1/fresh " in fresh
    assert without_starved(
        decay_monitor.run(created + timedelta(hours=5, minutes=59, seconds=59))
    ) == without_starved(fresh)
    heavy = decay_monitor.run(created + timedelta(hours=6))
    assert " outbox:1/heavy " in heavy
    assert without_starved(
        decay_monitor.run(created + timedelta(hours=17, minutes=59, seconds=59))
    ) == without_starved(heavy)
    bursting = decay_monitor.run(created + timedelta(hours=18))
    assert " outbox:1/bursting " in bursting
    assert without_starved(
        without_day(decay_monitor.run(created + timedelta(hours=47, minutes=59, seconds=59)))
    ) == without_starved(without_day(bursting))
    assert " outbox:0 " in decay_monitor.run(created + timedelta(hours=48))


def test_pent_up_stage_follows_the_oldest_active_item(state_dir, at, state_helpers):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "new",
                "created_at": now.isoformat(),
                "note": "a",
                "blocked_by": "error",
                "surfaced_at": None,
            },
            {
                "id": "old",
                "created_at": (now - timedelta(hours=7)).isoformat(),
                "note": "b",
                "blocked_by": "error",
                "surfaced_at": None,
            },
        ],
    )

    assert " outbox:2/heavy " in decay_monitor.run(now)


def test_probe_treats_http_404_as_up(listening_signals_url):
    assert decay_monitor.probe_transport() is True


def test_probe_reports_down_when_server_accepts_then_closes(monkeypatch):
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen()

    def accept_then_close():
        connection, _ = server.accept()
        connection.close()

    worker = threading.Thread(target=accept_then_close)
    worker.start()
    monkeypatch.setenv("YUI_SIGNALS_URL", f"http://127.0.0.1:{server.getsockname()[1]}/signals")
    try:
        assert decay_monitor.probe_transport() is False
    finally:
        server.close()
        worker.join()


def test_probe_falls_back_to_default_url_when_env_is_empty(monkeypatch):
    from tests.conftest import free_port

    monkeypatch.setenv("YUI_SIGNALS_URL", "")
    monkeypatch.setattr(desire_state, "DEFAULT_SIGNALS_URL", f"http://127.0.0.1:{free_port()}/signals")

    assert decay_monitor.probe_transport() is False


def test_summary_day_token_rolls_at_nine_kst(state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    start = at("2026-08-25T08:59:59+09:00")
    desire_state.bootstrap(start)
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": 100.0, "anchor_at": start.isoformat()},
            "accomplishment": {"level": 100.0, "anchor_at": start.isoformat()},
            "last_interaction_at": (start - timedelta(hours=10)).isoformat(),
            "last_interaction_hash": None,
        },
    )

    before = decay_monitor.run(start)
    after = decay_monitor.run(at("2026-08-25T09:00:00+09:00"))
    evening = decay_monitor.run(at("2026-08-25T23:59:59+09:00"))
    past_midnight = decay_monitor.run(at("2026-08-26T00:30:00+09:00"))

    assert before.endswith(" day:2026-08-24 rises:3 starved:0/0/0\n")
    assert after.endswith(" day:2026-08-25 rises:3 starved:0/0/0\n")
    assert before != after
    assert without_starved(evening) == without_starved(after)
    assert without_starved(past_midnight) == without_starved(after)


def test_postponed_note_leaves_the_summary_count_until_not_before(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "postponed",
                "created_at": now.isoformat(),
                "note": "later",
                "blocked_by": "budget",
                "surfaced_at": None,
                "not_before": (now + timedelta(hours=1)).isoformat(),
            }
        ],
    )

    assert " outbox:0 " in decay_monitor.run(now)
    assert [value["id"] for value in read_jsonl(state_dir / "outbox.jsonl")] == ["postponed"]
    assert " outbox:1/fresh " in decay_monitor.run(now + timedelta(hours=1))


def test_fallback_summary_wakes_the_tick_on_a_new_wake_day(monkeypatch, capsys, at):
    class FixedClock:
        moment = at("2026-08-25T12:00:00+09:00")

        @classmethod
        def now(cls, _timezone):
            return cls.moment

    def fail(_now):
        raise OSError("state unavailable")

    monkeypatch.setattr(decay_monitor, "datetime", FixedClock)
    monkeypatch.setattr(decay_monitor, "run", fail)

    decay_monitor.main()
    first = capsys.readouterr().out
    FixedClock.moment = at("2026-08-26T12:00:00+09:00")
    decay_monitor.main()
    second = capsys.readouterr().out

    assert first.endswith(" day:2026-08-25 rises:0 starved:0/0/0\n")
    assert second.endswith(" day:2026-08-26 rises:0 starved:0/0/0\n")
    assert first != second


def git_repo(workspace: Path, name: str, origin: str | None) -> Path:
    """Create a workspace directory, optionally with a git origin remote."""

    path = workspace / name
    (path / ".git").mkdir(parents=True)
    if origin is not None:
        (path / ".git" / "config").write_text(
            '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n'
            f"\turl = {origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n",
            encoding="utf-8",
        )
    return path


def skill(skills_root: Path, relative: str) -> Path:
    path = skills_root / relative
    path.mkdir(parents=True)
    (path / "SKILL.md").write_text("---\nname: x\n---\n", encoding="utf-8")
    return path


def gh_runner(payloads: dict, failing: tuple = (), views: dict | None = None):
    """Answer `gh <kind> list` from a `(command, repo)` table and `gh <kind> view` from a url table."""

    def run(args: list[str]) -> str:
        command = args[0]
        if args[1] == "view":
            url = args[2]
            if url in failing:
                raise RuntimeError("gh: HTTP 404")
            return json.dumps((views or {}).get(url, {}))
        repo = args[args.index("--repo") + 1]
        if command in failing or (command, repo) in failing:
            raise RuntimeError("gh: HTTP 404")
        return json.dumps(payloads.get((command, repo), []))

    return run


def audited(state_dir: Path, event: str) -> list[dict]:
    values = [json.loads(line) for line in (state_dir / "audit.jsonl").read_text().splitlines() if line]
    return [value for value in values if value["event"] == event]


def satisfied(state_dir: Path) -> list[dict]:
    return audited(state_dir, "drive_satisfied")


def derive(
    state_dir,
    now,
    tmp_path,
    *,
    payloads=None,
    failing=(),
    skills=(),
    views=None,
):
    """Run one derivation over a workspace holding `owner/YUI` and the named skills."""

    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    if not (workspace / "YUI").exists():
        git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    skills_root = tmp_path / "skills"
    skills_root.mkdir(exist_ok=True)
    for relative in skills:
        if not (skills_root / relative).exists():
            skill(skills_root, relative)
    return tick(
        state_dir,
        now,
        workspace_root=workspace,
        skills_root=skills_root,
        run_gh=gh_runner(payloads or {}, failing, views),
    )


def tick(state_dir, now, **sources):
    """Run both derivation phases the way the monitor does."""

    observed = decay_monitor.collect_artefacts(state_dir, now, **sources)
    decay_monitor.score_artefacts(state_dir, now, observed)
    return observed


def test_workspace_repos_reads_github_origins_only(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "memory_layer", "git@github.com:owner/memory_layer.git")
    git_repo(workspace, "internal", "https://gitlab.example.com/team/internal.git")
    git_repo(workspace, "no-remote", None)
    (workspace / "cron_results").mkdir()
    (workspace / "notes.md").write_text("loose file", encoding="utf-8")

    assert decay_monitor.workspace_repos(workspace) == ["owner/YUI", "owner/memory_layer"]


def test_workspace_repos_tolerates_a_missing_workspace(tmp_path):
    assert decay_monitor.workspace_repos(tmp_path / "absent") == []


def test_bootstrap_marks_every_artefact_seen_without_dosing(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {"url": "https://github.com/owner/YUI/pull/1", "headRefName": f"{BRANCH}a", "mergedAt": None},
                {
                    "url": "https://github.com/owner/YUI/pull/2",
                    "headRefName": f"{BRANCH}b",
                    "mergedAt": "2026-08-24T00:00:00Z",
                },
            ],
            ("issue", "owner/YUI"): [
                {
                    "url": "https://github.com/owner/YUI/issues/9",
                    "body": f"{MARKER}\nhello",
                    "closedAt": None,
                }
            ],
        },
        skills=("mcp/first", "second"),
    )

    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["bootstrapped_at"] == now.isoformat()
    assert artefacts["seen"]["pr"] == [
        "https://github.com/owner/YUI/pull/1",
        "https://github.com/owner/YUI/pull/2",
    ]
    assert artefacts["seen"]["issue"] == ["https://github.com/owner/YUI/issues/9"]
    assert artefacts["seen"]["skill"] == ["mcp/first", "second"]
    assert artefacts["shipped"] == ["https://github.com/owner/YUI/pull/2"]
    assert artefacts["unreported"] == []
    assert satisfied(state_dir) == []


def test_second_run_doses_a_new_agent_pull_request_exactly_once(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    payloads = {
        ("pr", "owner/YUI"): [
            {"url": "https://github.com/owner/YUI/pull/3", "headRefName": f"{BRANCH}c", "mergedAt": None}
        ]
    }
    derive(state_dir, now, tmp_path, payloads=payloads)
    derive(state_dir, now, tmp_path, payloads=payloads)

    assert [(event["event_type"], event["kind"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", "pr", "https://github.com/owner/YUI/pull/3")
    ]
    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["pr"] == ["https://github.com/owner/YUI/pull/3"]
    assert artefacts["unreported"] == [
        {
            "event": "progressed",
            "kind": "pr",
            "ref": "https://github.com/owner/YUI/pull/3",
            "at": now.isoformat(),
        }
    ]


def test_merged_pull_request_doses_shipped_exactly_once(state_dir, at, tmp_path):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)
    open_pull = {
        "url": "https://github.com/owner/YUI/pull/4",
        "headRefName": f"{BRANCH}d",
        "mergedAt": None,
    }
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [open_pull]})

    merged = {**open_pull, "mergedAt": "2026-08-25T11:00:00Z"}
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [merged]})
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [merged]})

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", "https://github.com/owner/YUI/pull/4"),
        ("shipped", "https://github.com/owner/YUI/pull/4"),
    ]


def test_pull_request_outside_the_agent_branch_prefix_is_never_scored(state_dir, at, tmp_path):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {
                    "url": "https://github.com/owner/YUI/pull/5",
                    "headRefName": "feat/other",
                    "mergedAt": "2026-08-25T11:00:00Z",
                }
            ]
        },
    )

    assert satisfied(state_dir) == []


def test_issue_without_the_marker_is_never_scored(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("issue", "owner/YUI"): [
                {"url": "https://github.com/owner/YUI/issues/10", "body": "plain body", "closedAt": None},
                {
                    "url": "https://github.com/owner/YUI/issues/11",
                    "body": f"{MARKER}\nmarked",
                    "closedAt": "2026-08-25T10:00:00Z",
                },
            ]
        },
    )

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", "https://github.com/owner/YUI/issues/11"),
        ("shipped", "https://github.com/owner/YUI/issues/11"),
    ]
    assert read_json(state_dir / "artefacts.json")["seen"]["issue"] == [
        "https://github.com/owner/YUI/issues/11"
    ]


def test_new_skill_directory_doses_progressed_on_first_sight(state_dir, at, tmp_path):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path, skills=("mcp/old",))

    derive(state_dir, now, tmp_path, skills=("mcp/old", "devops/new"))
    derive(state_dir, now, tmp_path, skills=("mcp/old", "devops/new"))

    assert [(event["event_type"], event["kind"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", "skill", "devops/new")
    ]


def test_only_a_skill_seen_after_bootstrap_records_its_first_sight(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    bootstrapped = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(bootstrapped)
    derive(state_dir, bootstrapped, tmp_path, skills=("mcp/old",))
    assert read_json(state_dir / "artefacts.json")["skill_first_seen"] == {}

    later = at("2026-08-26T12:00:00+09:00")
    derive(state_dir, later, tmp_path, skills=("mcp/old", "devops/new"))
    derive(state_dir, at("2026-08-27T12:00:00+09:00"), tmp_path, skills=("mcp/old", "devops/new"))

    assert read_json(state_dir / "artefacts.json")["skill_first_seen"] == {"devops/new": later.isoformat()}


def test_a_capped_skill_still_records_its_first_sight(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)
    for index in range(desire_state.EVENT_DAILY_CAPS["progressed"]):
        desire_state.satisfy("progressed", f"filler {index}", now)

    derive(state_dir, now, tmp_path, skills=("mcp/capped",))

    assert read_json(state_dir / "artefacts.json")["skill_first_seen"] == {"mcp/capped": now.isoformat()}


def test_event_past_its_daily_cap_is_still_marked_seen_and_audits_satisfy_blocked(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)
    for index in range(desire_state.EVENT_DAILY_CAPS["progressed"]):
        desire_state.satisfy("progressed", f"filler {index}", now)

    derive(state_dir, now, tmp_path, skills=("mcp/capped",))

    blocked = audited(state_dir, "satisfy_blocked")
    assert [(event["event_type"], event["ref"], event["kind"]) for event in blocked] == [
        ("progressed", "mcp/capped", "skill")
    ]
    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["skill"] == ["mcp/capped"]
    assert artefacts["unreported"] == []


def test_failing_source_audits_derive_failed_and_leaves_its_cursor(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {"url": "https://github.com/owner/YUI/pull/6", "headRefName": f"{BRANCH}e", "mergedAt": None}
            ]
        },
        failing=("issue",),
    )

    failures = audited(state_dir, "derive_failed")
    assert [(event["source"], event["repo"]) for event in failures] == [("issue", "owner/YUI")]
    assert "404" in failures[0]["error"]
    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["issue"] == []
    assert artefacts["seen"]["pr"] == ["https://github.com/owner/YUI/pull/6"]


def test_a_source_that_failed_during_bootstrap_bootstraps_when_it_recovers(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    existing = {
        "url": "https://github.com/owner/YUI/pull/1",
        "headRefName": f"{BRANCH}a",
        "mergedAt": "2026-08-24T00:00:00Z",
    }
    payloads = {("pr", "owner/YUI"): [existing]}

    derive(state_dir, now, tmp_path, payloads=payloads, failing=("pr",))

    assert satisfied(state_dir) == []
    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == []

    derive(state_dir, now, tmp_path, payloads=payloads)

    assert satisfied(state_dir) == []
    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["pr"] == [existing["url"]]
    assert artefacts["shipped"] == [existing["url"]]

    fresh = {"url": "https://github.com/owner/YUI/pull/2", "headRefName": f"{BRANCH}b", "mergedAt": None}
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [existing, fresh]})

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", fresh["url"])
    ]


def test_monitor_run_scores_a_new_skill_into_unreported(state_dir, at, isolated_profile, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    skills_root = isolated_profile / ".hermes" / "profiles" / PROFILE_NAME / "skills"
    skill(skills_root, "mcp/known")

    decay_monitor.run(now)
    skill(skills_root, "devops/new")
    output = decay_monitor.run(now)

    assert output.endswith(" rises:0 starved:0/0/0\n")
    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", "devops/new")
    ]
    assert read_json(state_dir / "artefacts.json")["unreported"] == [
        {"event": "progressed", "kind": "skill", "ref": "devops/new", "at": now.isoformat()}
    ]


def two_repo_workspace(tmp_path, second_origin: str) -> Path:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "YUI-clone", second_origin)
    return workspace


def two_repo_tick(state_dir, now, workspace, tmp_path, payloads, failing=()):
    return tick(
        state_dir,
        now,
        workspace_root=workspace,
        skills_root=tmp_path / "skills",
        run_gh=gh_runner(payloads, failing),
    )


def test_two_workspace_directories_sharing_an_origin_dose_once(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    workspace = two_repo_workspace(tmp_path, "https://github.com/owner/YUI.git")
    two_repo_tick(state_dir, now, workspace, tmp_path, {})
    payloads = {
        ("pr", "owner/YUI"): [
            {"url": "https://github.com/owner/YUI/pull/7", "headRefName": f"{BRANCH}f", "mergedAt": None}
        ]
    }

    two_repo_tick(state_dir, now, workspace, tmp_path, payloads)

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", "https://github.com/owner/YUI/pull/7")
    ]
    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["pr"] == ["https://github.com/owner/YUI/pull/7"]
    assert read_json(state_dir / "budget.json")["events"] == {"progressed": 1}


def test_a_repository_failing_during_bootstrap_leaves_the_kind_unbootstrapped(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    workspace = two_repo_workspace(tmp_path, "https://github.com/owner/memory_layer.git")
    healthy = {"url": "https://github.com/owner/YUI/pull/8", "headRefName": f"{BRANCH}g", "mergedAt": None}

    two_repo_tick(
        state_dir,
        now,
        workspace,
        tmp_path,
        {("pr", "owner/YUI"): [healthy]},
        failing=(("pr", "owner/memory_layer"),),
    )

    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["pr"] == []
    assert "pr" not in artefacts["bootstrapped"]
    assert "issue" in artefacts["bootstrapped"]
    assert satisfied(state_dir) == []


def test_a_repository_failing_after_bootstrap_still_scores_the_healthy_one(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    workspace = two_repo_workspace(tmp_path, "https://github.com/owner/memory_layer.git")
    two_repo_tick(state_dir, now, workspace, tmp_path, {})
    healthy = {"url": "https://github.com/owner/YUI/pull/9", "headRefName": f"{BRANCH}h", "mergedAt": None}

    two_repo_tick(
        state_dir,
        now,
        workspace,
        tmp_path,
        {("pr", "owner/YUI"): [healthy]},
        failing=(("pr", "owner/memory_layer"),),
    )

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", healthy["url"])
    ]
    assert [(event["source"], event["repo"]) for event in audited(state_dir, "derive_failed")] == [
        ("pr", "owner/memory_layer")
    ]
    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == [healthy["url"]]


def test_a_merged_pull_request_outside_the_list_window_is_shipped_from_its_own_view(state_dir, at, tmp_path):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    url = "https://github.com/owner/YUI/pull/10"
    listed = {"url": url, "headRefName": f"{BRANCH}i", "mergedAt": None}
    derive(state_dir, now, tmp_path)
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [listed]})

    derive(state_dir, now, tmp_path, views={url: {"state": "MERGED", "mergedAt": "2026-08-25T11:00:00Z"}})
    derive(state_dir, now, tmp_path, views={url: {"state": "MERGED", "mergedAt": "2026-08-25T11:00:00Z"}})

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", url),
        ("shipped", url),
    ]


def test_a_closed_issue_outside_the_list_window_is_shipped_from_its_own_view(state_dir, at, tmp_path):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    url = "https://github.com/owner/YUI/issues/12"
    listed = {"url": url, "body": f"{MARKER}\nhi", "closedAt": None}
    derive(state_dir, now, tmp_path)
    derive(state_dir, now, tmp_path, payloads={("issue", "owner/YUI"): [listed]})

    derive(state_dir, now, tmp_path, views={url: {"state": "CLOSED", "closedAt": "2026-08-25T11:00:00Z"}})

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", url),
        ("shipped", url),
    ]


def test_a_failing_view_call_audits_that_artefact_and_leaves_it_for_the_next_tick(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    url = "https://github.com/owner/YUI/pull/11"
    listed = {"url": url, "headRefName": f"{BRANCH}j", "mergedAt": None}
    derive(state_dir, now, tmp_path)
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [listed]})

    derive(state_dir, now, tmp_path, failing=(url,))

    failures = audited(state_dir, "derive_failed")
    assert [(event["source"], event["ref"]) for event in failures] == [("pr", url)]
    assert read_json(state_dir / "artefacts.json")["shipped"] == []

    derive(state_dir, now, tmp_path, views={url: {"state": "MERGED", "mergedAt": "2026-08-25T11:00:00Z"}})

    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [
        ("progressed", url),
        ("shipped", url),
    ]


def test_a_malformed_ref_audits_derive_failed_instead_of_vanishing(state_dir, at, tmp_path):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)
    url = "https://github.com/owner/YUI/pull/3"

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {"url": 12, "headRefName": f"{BRANCH}broken", "mergedAt": None},
                {"url": url, "headRefName": f"{BRANCH}good", "mergedAt": None},
            ]
        },
    )

    failures = audited(state_dir, "derive_failed")
    assert [event["source"] for event in failures] == ["pr"]
    assert "12" in failures[0]["error"]
    assert [(event["event_type"], event["ref"]) for event in satisfied(state_dir)] == [("progressed", url)]


def test_sources_are_read_before_the_tick_takes_the_state_lock(state_dir, at, isolated_profile, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    workspace = isolated_profile / ".hermes" / "profiles" / PROFILE_NAME / "workspace"
    workspace.mkdir(parents=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    acquired = []

    def probe_lock(args):
        def take():
            with desire_state.state_lock(state_dir):
                acquired.append(args[0])

        worker = threading.Thread(target=take, daemon=True)
        worker.start()
        worker.join(timeout=5)
        assert not worker.is_alive(), "the tick held the state lock while reading a source"
        return "[]"

    monkeypatch.setattr(decay_monitor, "run_gh", probe_lock)

    decay_monitor.run(now)

    assert acquired == ["pr", "issue"]


def test_monitor_run_derives_from_the_profile_and_prints_the_summary_when_a_source_fails(
    state_dir, at, isolated_profile, monkeypatch, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    profile = isolated_profile / ".hermes" / "profiles" / PROFILE_NAME
    workspace = profile / "workspace"
    workspace.mkdir(parents=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    skill(profile / "skills", "mcp/known")

    def failing_gh(args):
        raise RuntimeError("gh: could not authenticate")

    monkeypatch.setattr(decay_monitor, "run_gh", failing_gh)

    output = decay_monitor.run(now)

    assert output == (
        "social:low curiosity:mid accomplishment:mid outbox:0 transport:down "
        "budget:3/3sig 2/2iss 1/1cmt 1/1pr day:2026-08-25 rises:0 starved:0/0/0\n"
    )
    assert [event["source"] for event in audited(state_dir, "derive_failed")] == ["pr", "issue"]
    assert read_json(state_dir / "artefacts.json")["seen"]["skill"] == ["mcp/known"]
