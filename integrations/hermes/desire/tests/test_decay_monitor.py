import re
import socket
import threading
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
        b"social:low curiosity:mid accomplishment:mid outbox:0 transport:down "
        b"budget:3/3sig 2/2iss 1/1cmt day:2026-08-25\n"
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

    assert (
        output == "social:high curiosity:mid accomplishment:high outbox:1/fresh transport:down "
        "budget:2/3sig 1/2iss 0/1cmt day:2026-08-25\n"
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
        "budget:3/3sig 2/2iss 1/1cmt day:2026-08-25\n"
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
    assert after_output.endswith("budget:3/3sig 2/2iss 1/1cmt day:2026-08-25\n")
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
        "budget:3/3sig 2/2iss 1/1cmt day:2026-08-25\n"
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
        "social:low curiosity:mid accomplishment:mid outbox:0 transport:down budget:3/3sig 2/2iss 1/1cmt\n"
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
    assert decay_monitor.run(created + timedelta(hours=5, minutes=59, seconds=59)) == fresh
    heavy = decay_monitor.run(created + timedelta(hours=6))
    assert " outbox:1/heavy " in heavy
    assert decay_monitor.run(created + timedelta(hours=17, minutes=59, seconds=59)) == heavy
    bursting = decay_monitor.run(created + timedelta(hours=18))
    assert " outbox:1/bursting " in bursting
    assert " outbox:1/bursting " in decay_monitor.run(created + timedelta(hours=47, minutes=59, seconds=59))
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

    assert before.endswith(" day:2026-08-24\n")
    assert after.endswith(" day:2026-08-25\n")
    assert before != after
    assert evening == after
    assert past_midnight == after


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
