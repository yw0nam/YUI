from datetime import timedelta

import pytest

import desire_drives
import desire_state
import desire_store


def test_naive_now_is_rejected(state_dir):
    from datetime import datetime

    with pytest.raises(ValueError, match="timezone"):
        desire_state.bootstrap(datetime(2026, 8, 25, 12, 0))  # noqa: DTZ001 - deliberately naive


def test_bootstrap_creates_all_defaults(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T09:00:00+09:00")

    desire_state.bootstrap(now)

    drives = read_json(state_dir / "drives.json")
    assert drives == {
        "curiosity": {"level": 50.0, "anchor_at": now.isoformat()},
        "accomplishment": {"level": 50.0, "anchor_at": now.isoformat()},
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
        "events": {},
        "pending": {},
    }
    assert read_json(state_dir / "cursor.json") == {"last_feedback_check_at": now.isoformat()}
    assert read_json(state_dir / "monitor.json") == {
        "latched": {"social": "low", "curiosity": "mid", "accomplishment": "mid"},
        "natural": {"social": "low", "curiosity": "mid", "accomplishment": "mid"},
        "rises": 0,
        "saturated_since": {"social": None, "curiosity": None, "accomplishment": None},
    }
    assert (state_dir / "outbox.jsonl").read_bytes() == b""
    assert (state_dir / "audit.jsonl").read_bytes() == b""
    assert (state_dir / "ticks.jsonl").read_bytes() == b""
    assert (state_dir / "state.lock").exists()


def test_corrupt_json_is_quarantined_and_audited(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T09:00:00+09:00")
    state_dir.mkdir(exist_ok=True)
    (state_dir / "drives.json").write_text("{broken", encoding="utf-8")

    desire_state.bootstrap(now)

    assert read_json(state_dir / "drives.json")["curiosity"]["level"] == 50.0
    assert len(list(state_dir.glob("drives.json.corrupt-20260825090000"))) == 1
    assert any(event["event"] == "state_corrupt_recovered" for event in read_jsonl(state_dir / "audit.jsonl"))


def test_event_dose_tables_are_fixed():
    assert desire_drives.EVENT_DOSES == {
        "learned": {"curiosity": 30.0},
        "progressed": {"accomplishment": 15.0},
        "shipped": {"accomplishment": 40.0},
        "praised": {"accomplishment": 25.0},
    }
    assert desire_state.EVENT_DAILY_CAPS == {"learned": 6, "progressed": 6, "shipped": 4, "praised": 4}


@pytest.mark.parametrize(
    ("event_type", "drive", "dose"),
    [
        ("learned", "curiosity", 30.0),
        ("progressed", "accomplishment", 15.0),
        ("shipped", "accomplishment", 40.0),
        ("praised", "accomplishment", 25.0),
    ],
)
def test_satisfy_applies_fixed_dose_clamps_reanchors_and_audits(
    state_dir, at, state_helpers, event_type, drive, dose
):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    drives = read_json(state_dir / "drives.json")
    drives[drive] = {"level": 10.0, "anchor_at": now.isoformat()}
    write_json(state_dir / "drives.json", drives)

    reward = desire_state.satisfy(event_type, "https://example.test/pull/1", now, kind="pr")

    drives = read_json(state_dir / "drives.json")
    assert drives[drive] == {"level": 0.0, "anchor_at": now.isoformat()}
    assert reward > 0
    assert read_json(state_dir / "budget.json")["events"] == {event_type: 1}
    event = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert event == {
        "at": now.isoformat(),
        "event": "drive_satisfied",
        "event_type": event_type,
        "doses": {drive: dose},
        "reward": round(reward, 4),
        "ref": "https://example.test/pull/1",
        "kind": "pr",
    }


def test_satisfy_without_a_kind_audits_the_reference_alone(state_dir, at, state_helpers):
    _, _, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    desire_state.satisfy("praised", "he liked the fix", now)

    event = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert event["ref"] == "he liked the fix"
    assert "kind" not in event
    assert "why" not in event


def test_satisfy_learned_refuses_a_source_it_already_scored(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    ref = "https://github.com/owner/YUI/commit/abc"

    desire_state.satisfy("learned", ref, now)
    dosed = read_json(state_dir / "drives.json")["curiosity"]["level"]

    with pytest.raises(ValueError, match="already reported"):
        desire_state.satisfy("learned", ref, now)

    assert read_json(state_dir / "drives.json")["curiosity"]["level"] == dosed
    assert read_json(state_dir / "budget.json")["events"] == {"learned": 1}
    audit = read_jsonl(state_dir / "audit.jsonl")
    assert sum(1 for event in audit if event["event"] == "drive_satisfied") == 1
    assert audit[-1] == {
        "at": now.isoformat(),
        "event": "satisfy_repeated",
        "event_type": "learned",
        "ref": ref,
    }
    assert read_json(state_dir / "artefacts.json")["learned"] == [ref]


def test_satisfy_learned_still_refuses_a_source_on_a_later_day(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    ref = "docs/reference/motions.md"
    desire_state.satisfy("learned", ref, at("2026-08-25T12:00:00+09:00"))
    spent = read_json(state_dir / "budget.json")

    with pytest.raises(ValueError, match="already reported"):
        desire_state.satisfy("learned", ref, at("2026-08-28T12:00:00+09:00"))

    assert read_json(state_dir / "budget.json") == spent


def test_satisfy_learned_remembers_the_last_500_sources(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_json, _, _, _ = state_helpers
    record = desire_store.default_artefacts(now)
    record["learned"] = [f"source {index}" for index in range(desire_state.LEARNED_MEMORY)]
    write_json(state_dir / "artefacts.json", record)

    desire_state.satisfy("learned", "one more source", now)

    remembered = read_json(state_dir / "artefacts.json")["learned"]
    assert len(remembered) == desire_state.LEARNED_MEMORY
    assert remembered[-1] == "one more source"
    assert remembered[0] == "source 1"


def test_satisfy_learned_leaves_a_capped_source_reportable(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    for index in range(desire_state.EVENT_DAILY_CAPS["learned"]):
        desire_state.satisfy("learned", f"source {index}", now)

    with pytest.raises(ValueError, match="over budget"):
        desire_state.satisfy("learned", "one more source", now)

    assert "one more source" not in read_json(state_dir / "artefacts.json")["learned"]

    desire_state.satisfy("learned", "one more source", at("2026-08-26T12:00:00+09:00"))

    assert read_json(state_dir / "artefacts.json")["learned"][-1] == "one more source"


def test_satisfy_praised_scores_the_same_reference_again(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    desire_state.satisfy("praised", "he said the fix reads well", now)
    desire_state.satisfy("praised", "he said the fix reads well", now)

    assert read_json(state_dir / "budget.json")["events"] == {"praised": 2}


def test_satisfy_rejects_unknown_event(state_dir, at):
    with pytest.raises(ValueError, match="unknown event: comforted"):
        desire_state.satisfy("comforted", "talked", at("2026-08-25T12:00:00+09:00"))


def test_satisfy_daily_cap_resets_at_kst_midnight(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    before_midnight = at("2026-08-25T23:59:59+09:00")
    for index in range(6):
        desire_state.satisfy("learned", f"lesson {index}", before_midnight)

    with pytest.raises(ValueError, match=r"over budget: learned daily cap is 6"):
        desire_state.satisfy("learned", "one too many", before_midnight)
    audit = read_jsonl(state_dir / "audit.jsonl")
    assert sum(1 for event in audit if event["event"] == "drive_satisfied") == 6
    assert audit[-1] == {
        "at": before_midnight.isoformat(),
        "event": "satisfy_blocked",
        "event_type": "learned",
        "ref": "one too many",
    }

    desire_state.satisfy("learned", "new KST day", at("2026-08-26T00:00:00+09:00"))

    budget = read_json(state_dir / "budget.json")
    assert budget["date"] == "2026-08-26"
    assert budget["events"] == {"learned": 1}


def test_invalid_budget_events_value_is_coerced_not_quarantined(state_dir, at, state_helpers):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {
            "date": "2026-08-25",
            "signals": 1,
            "issues": 0,
            "self_comments": 0,
            "prs": 0,
            "events": ["learned"],
            "pending": {"resv": {"kind": "issue", "date": "2026-08-25"}},
        },
    )

    desire_state.satisfy("learned", "read the paper", now)

    budget = read_json(state_dir / "budget.json")
    assert budget["signals"] == 1
    assert budget["pending"] == {"resv": {"kind": "issue", "date": "2026-08-25"}}
    assert budget["events"] == {"learned": 1}
    assert not any(
        event["event"] == "state_corrupt_recovered" for event in read_jsonl(state_dir / "audit.jsonl")
    )


def test_normalize_budget_clamps_negative_event_counters(state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {
            "date": "2026-08-25",
            "signals": 0,
            "issues": 0,
            "self_comments": 0,
            "prs": 0,
            "events": {"learned": -50},
            "pending": {},
        },
    )
    for index in range(6):
        desire_state.satisfy("learned", f"lesson {index}", now)

    with pytest.raises(ValueError, match=r"over budget: learned daily cap is 6"):
        desire_state.satisfy("learned", "one too many", now)


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
