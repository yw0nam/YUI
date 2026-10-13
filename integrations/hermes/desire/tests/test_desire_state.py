from datetime import datetime, timedelta

import pytest

import desire_drives
import desire_state


def test_naive_now_is_rejected(state_dir):
    with pytest.raises(ValueError, match="timezone"):
        desire_state.bootstrap(datetime(2026, 8, 25, 12, 0))  # noqa: DTZ001 - deliberately naive


def test_bootstrap_creates_all_defaults(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T09:00:00+09:00")

    desire_state.bootstrap(now)

    assert read_json(state_dir / "drives.json") == {
        "last_interaction_at": now.isoformat(),
        "last_interaction_hash": None,
        "last_signal_at": None,
        "last_signal_answered_at": None,
    }
    assert read_json(state_dir / "budget.json") == {
        "date": "2026-08-25",
        "signals": 0,
        "issues": 0,
        "self_comments": 0,
        "prs": 0,
        "pending": {},
    }
    assert (state_dir / "outbox.jsonl").read_bytes() == b""
    assert (state_dir / "audit.jsonl").read_bytes() == b""
    assert not (state_dir / "monitor.json").exists()
    assert not (state_dir / "ticks.jsonl").exists()
    assert (state_dir / "state.lock").exists()


def test_bootstrap_deletes_the_monitor_leftovers(state_dir, at):
    now = at("2026-08-25T09:00:00+09:00")
    (state_dir / "monitor.json").write_text("{}", encoding="utf-8")
    (state_dir / "ticks.jsonl").write_text('{"at": "x"}\n', encoding="utf-8")

    desire_state.bootstrap(now)

    assert not (state_dir / "monitor.json").exists()
    assert not (state_dir / "ticks.jsonl").exists()


def test_corrupt_json_is_quarantined_and_audited(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T09:00:00+09:00")
    state_dir.mkdir(exist_ok=True)
    (state_dir / "drives.json").write_text("{broken", encoding="utf-8")

    desire_state.bootstrap(now)

    assert read_json(state_dir / "drives.json")["last_interaction_at"] == now.isoformat()
    assert len(list(state_dir.glob("drives.json.corrupt-20260825090000"))) == 1
    assert any(event["event"] == "state_corrupt_recovered" for event in read_jsonl(state_dir / "audit.jsonl"))


def test_bootstrap_keeps_valid_signal_stamps_and_recovers_invalid_ones(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    sent = (now - timedelta(hours=3)).isoformat()
    stored = read_json(state_dir / "drives.json")
    write_json(
        state_dir / "drives.json",
        {**stored, "last_signal_at": sent, "last_signal_answered_at": None},
    )

    desire_state.bootstrap(now)

    assert read_json(state_dir / "drives.json")["last_signal_at"] == sent
    assert desire_drives.read_drives_snapshot(state_dir, now)["last_signal_at"] == sent

    write_json(state_dir / "drives.json", {**stored, "last_signal_at": "not-a-date"})
    desire_state.bootstrap(now)
    assert read_json(state_dir / "drives.json")["last_signal_at"] is None
    assert list(state_dir.glob("drives.json.corrupt-*"))
