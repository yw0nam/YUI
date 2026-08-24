import json
from datetime import timedelta

import desire_state
import pytest


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


def test_satisfy_subtracts_clamps_reanchors_and_audits(state_dir, at, state_helpers):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    drives = read_json(state_dir / "drives.json")
    drives["curiosity"] = {"level": 10.0, "anchor_at": (now - timedelta(hours=1)).isoformat()}
    write_json(state_dir / "drives.json", drives)

    desire_state.satisfy("curiosity", 20, "learned it", now)

    drives = read_json(state_dir / "drives.json")
    assert drives["curiosity"] == {"level": 0.0, "anchor_at": now.isoformat()}
    event = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert event | {"at": now.isoformat()} == event
    assert event["event"] == "drive_satisfied"
    assert event["drive"] == "curiosity"
    assert event["why"] == "learned it"


def test_satisfy_rejects_social(state_dir, at):
    with pytest.raises(ValueError, match="social"):
        desire_state.satisfy("social", 10, "talked", at("2026-08-25T12:00:00+09:00"))


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
