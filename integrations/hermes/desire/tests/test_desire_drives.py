import math
from datetime import timedelta

import pytest

import desire_drives
import desire_state


def test_drive_math_rises_clamps_and_clamps_future_elapsed(at):
    now = at("2026-08-25T12:00:00+09:00")
    drives = {
        "curiosity": {"level": 50.0, "anchor_at": (now - timedelta(hours=2)).isoformat()},
        "accomplishment": {"level": 99.0, "anchor_at": (now - timedelta(hours=2)).isoformat()},
        "last_interaction_at": (now - timedelta(hours=30)).isoformat(),
        "last_interaction_hash": None,
    }

    levels = desire_drives.drive_levels(drives, now)

    assert levels == {"social": 100.0, "curiosity": 68.0, "accomplishment": 100.0}
    drives["curiosity"] = {"level": -1.0, "anchor_at": (now + timedelta(hours=2)).isoformat()}
    drives["accomplishment"] = {"level": 35.0, "anchor_at": (now + timedelta(hours=2)).isoformat()}
    levels = desire_drives.drive_levels(drives, now)
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
    assert desire_drives.drive_levels(drives, now)["social"] == 52.5


@pytest.mark.parametrize(
    ("level", "expected"),
    [(39.99, "low"), (40.0, "mid"), (69.99, "mid"), (70.0, "high")],
)
def test_bucket_boundaries(level, expected):
    assert desire_drives.bucket(level) == expected


def test_displayed_level_truncates():
    assert desire_drives.displayed_level(39.99) == 39
    assert desire_drives.displayed_level(70.99) == 70


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
    assert desire_drives.homeostatic_drive(before) - desire_drives.homeostatic_drive(after) == pytest.approx(
        expected
    )
    assert reward == pytest.approx(0.21)

    other_drive_starving_before = before | {"accomplishment": 100.0}
    other_drive_starving_after = after | {"accomplishment": 100.0}
    cross_drive_reward = desire_drives.homeostatic_drive(
        other_drive_starving_before
    ) - desire_drives.homeostatic_drive(other_drive_starving_after)
    assert cross_drive_reward == pytest.approx(math.sqrt(1.0 + 0.5**4) - math.sqrt(1.0 + 0.2**4))
    assert cross_drive_reward < reward


def test_satisfy_reward_uses_decayed_level_and_derived_social(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    drives = read_json(state_dir / "drives.json")
    drives["curiosity"] = {"level": 10.0, "anchor_at": (now - timedelta(hours=1)).isoformat()}
    drives["accomplishment"] = {"level": 50.0, "anchor_at": now.isoformat()}
    drives["last_interaction_at"] = (now - timedelta(hours=10)).isoformat()
    write_json(state_dir / "drives.json", drives)

    reward = desire_state.satisfy("learned", "read the paper", now)

    # curiosity rises CURIOSITY_RATE(9.0)/h * 1h on top of the stored 10.0 -> 19.0 before the dose lands.
    # social derives from a 10h-old last_interaction_at -> SOCIAL_RATE(15.0) * 10 = 150 -> clamped to 100.
    before = {"social": 100.0, "curiosity": 19.0, "accomplishment": 50.0}
    after = {"social": 100.0, "curiosity": 0.0, "accomplishment": 50.0}
    expected = desire_drives.homeostatic_drive(before) - desire_drives.homeostatic_drive(after)
    assert reward == pytest.approx(expected)

    # A satisfy that ignored decay (dosing the stored 10.0) or social (treating it as 0) would not match.
    ignoring_decay_and_social = desire_drives.homeostatic_drive(
        {"social": 0.0, "curiosity": 10.0, "accomplishment": 50.0}
    ) - desire_drives.homeostatic_drive({"social": 0.0, "curiosity": 0.0, "accomplishment": 50.0})
    assert reward != pytest.approx(ignoring_decay_and_social)

    drives_after = read_json(state_dir / "drives.json")
    assert drives_after["curiosity"] == {"level": 0.0, "anchor_at": now.isoformat()}


def test_default_drives_start_the_signal_stamps_empty(at):
    now = at("2026-08-25T09:00:00+09:00")
    drives = desire_drives.default_drives(now)
    assert drives["last_signal_at"] is None
    assert drives["last_signal_answered_at"] is None
