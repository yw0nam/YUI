import json
import math
from datetime import timedelta

import pytest

import desire_state


def test_drive_math_rises_clamps_and_clamps_future_elapsed(at):
    now = at("2026-08-25T12:00:00+09:00")
    drives = {
        "curiosity": {"level": 50.0, "anchor_at": (now - timedelta(hours=2)).isoformat()},
        "accomplishment": {"level": 99.0, "anchor_at": (now - timedelta(hours=2)).isoformat()},
        "last_interaction_at": (now - timedelta(hours=30)).isoformat(),
        "last_interaction_hash": None,
    }

    levels = desire_state.drive_levels(drives, now)

    assert levels == {"social": 100.0, "curiosity": 56.0, "accomplishment": 100.0}
    drives["curiosity"] = {"level": -1.0, "anchor_at": (now + timedelta(hours=2)).isoformat()}
    drives["accomplishment"] = {"level": 35.0, "anchor_at": (now + timedelta(hours=2)).isoformat()}
    levels = desire_state.drive_levels(drives, now)
    assert levels["curiosity"] == 0.0
    assert levels["accomplishment"] == 35.0


def test_social_depends_only_on_last_interaction(at):
    now = at("2026-08-25T12:00:00+09:00")
    drives = {
        "curiosity": {"level": 100.0, "anchor_at": now.isoformat()},
        "accomplishment": {"level": 0.0, "anchor_at": now.isoformat()},
        "last_interaction_at": (now - timedelta(hours=3, minutes=30)).isoformat(),
        "last_interaction_hash": None,
    }
    assert desire_state.drive_levels(drives, now)["social"] == 17.5


@pytest.mark.parametrize(
    ("level", "expected"),
    [(39.99, "low"), (40.0, "mid"), (69.99, "mid"), (70.0, "high")],
)
def test_bucket_boundaries(level, expected):
    assert desire_state.bucket(level) == expected


def test_displayed_level_truncates():
    assert desire_state.displayed_level(39.99) == 39
    assert desire_state.displayed_level(70.99) == 70


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
    }
    assert read_json(state_dir / "budget.json") == {
        "date": "2026-08-25",
        "signals": 0,
        "issues": 0,
        "self_comments": 0,
        "events": {},
        "pending": {},
    }
    assert read_json(state_dir / "cursor.json") == {"last_feedback_check_at": now.isoformat()}
    assert (state_dir / "outbox.jsonl").read_bytes() == b""
    assert (state_dir / "audit.jsonl").read_bytes() == b""
    assert (state_dir / "state.lock").exists()


def test_state_dir_falls_back_to_profile(monkeypatch, tmp_path):
    monkeypatch.delenv("DESIRE_STATE_DIR", raising=False)
    monkeypatch.setenv("HERMES_PROFILE", "test-profile")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert desire_state.resolve_state_dir() == tmp_path / ".hermes/profiles/test-profile/desire"


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
    assert desire_state.EVENT_DOSES == {
        "learned": {"curiosity": 30.0},
        "progressed": {"accomplishment": 15.0},
        "shipped": {"accomplishment": 40.0},
        "praised": {"accomplishment": 25.0},
    }
    assert desire_state.EVENT_DAILY_CAPS == {"learned": 3, "progressed": 3, "shipped": 2, "praised": 2}


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

    reward = desire_state.satisfy(event_type, "earned it", now)

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
        "why": "earned it",
    }


def test_satisfy_reward_matches_homeostatic_drive_reduction(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    drives = read_json(state_dir / "drives.json")
    drives["curiosity"] = {"level": 50.0, "anchor_at": now.isoformat()}
    drives["accomplishment"] = {"level": 0.0, "anchor_at": now.isoformat()}
    write_json(state_dir / "drives.json", drives)

    reward = desire_state.satisfy("learned", "read the paper", now)

    before = {"social": 0.0, "curiosity": 50.0, "accomplishment": 0.0}
    after = {"social": 0.0, "curiosity": 20.0, "accomplishment": 0.0}
    expected = math.sqrt(0.5**4) - math.sqrt(0.2**4)
    assert desire_state.homeostatic_drive(before) - desire_state.homeostatic_drive(after) == pytest.approx(
        expected
    )
    assert reward == pytest.approx(0.21)

    other_drive_starving_before = before | {"accomplishment": 100.0}
    other_drive_starving_after = after | {"accomplishment": 100.0}
    cross_drive_reward = desire_state.homeostatic_drive(
        other_drive_starving_before
    ) - desire_state.homeostatic_drive(other_drive_starving_after)
    assert cross_drive_reward == pytest.approx(math.sqrt(1.0 + 0.5**4) - math.sqrt(1.0 + 0.2**4))
    assert cross_drive_reward < reward


def test_satisfy_rejects_unknown_event(state_dir, at):
    with pytest.raises(ValueError, match="unknown event: comforted"):
        desire_state.satisfy("comforted", "talked", at("2026-08-25T12:00:00+09:00"))


def test_satisfy_daily_cap_resets_at_kst_midnight(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    before_midnight = at("2026-08-25T23:59:59+09:00")
    for index in range(3):
        desire_state.satisfy("learned", f"lesson {index}", before_midnight)

    with pytest.raises(ValueError, match=r"over budget: learned daily cap is 3"):
        desire_state.satisfy("learned", "one too many", before_midnight)
    assert len(read_jsonl(state_dir / "audit.jsonl")) == 3

    desire_state.satisfy("learned", "new KST day", at("2026-08-26T00:00:00+09:00"))

    budget = read_json(state_dir / "budget.json")
    assert budget["date"] == "2026-08-26"
    assert budget["events"] == {"learned": 1}


def test_serialize_desire_block_marks_pent_up_day_boundaries(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    items = [
        {
            "id": "fresh",
            "created_at": (now - timedelta(hours=23, minutes=59, seconds=59)).isoformat(),
            "note": "fresh",
        },
        {"id": "heavy", "created_at": (now - timedelta(hours=24)).isoformat(), "note": "heavy"},
        {"id": "bursting", "created_at": (now - timedelta(hours=72)).isoformat(), "note": "bursting"},
    ]

    block = desire_state.serialize_desire_block(levels, items, now)

    assert "- [2026-08-24 12:00] fresh" in block
    assert "- [2026-08-24 12:00] (waited 1d, heavy) heavy" in block
    assert "- [2026-08-22 12:00] (waited 3d, bursting) bursting" in block


def test_malformed_jsonl_is_skipped_and_unterminated_tail_is_separated(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    path = state_dir / "outbox.jsonl"
    path.write_bytes(b'{"id":"good"}\n{malformed tail')
    assert desire_state.read_jsonl(path) == [{"id": "good"}]

    desire_state.append_jsonl(path, {"id": "new", "created_at": now.isoformat()})

    assert path.read_bytes().endswith(b'{"id": "new", "created_at": "2026-08-25T12:00:00+09:00"}\n')
    assert desire_state.read_jsonl(path)[-1]["id"] == "new"
    assert path.read_text(encoding="utf-8").splitlines()[-1] == json.dumps(
        {"id": "new", "created_at": now.isoformat()}
    )


def test_public_jsonl_reader_reports_dropped_lines(state_dir):
    path = state_dir / "outbox.jsonl"
    path.write_text('{"id":"good"}\n{broken}\n', encoding="utf-8")

    values, dropped = desire_state.read_jsonl_with_dropped(path)

    assert values == [{"id": "good"}]
    assert dropped == 1
