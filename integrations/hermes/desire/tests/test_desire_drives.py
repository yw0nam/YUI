from datetime import timedelta

import desire_drives


def test_default_drives_carry_only_the_four_stamps(at):
    now = at("2026-08-25T09:00:00+09:00")

    assert desire_drives.default_drives(now) == {
        "last_interaction_at": now.isoformat(),
        "last_interaction_hash": None,
        "last_signal_at": None,
        "last_signal_answered_at": None,
    }


def test_read_drives_snapshot_returns_only_the_stamps_from_an_installed_level_record(
    state_dir, at, state_helpers
):
    write_json, _, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    sent = (now - timedelta(hours=2)).isoformat()
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": 42.0, "anchor_at": sent},
            "accomplishment": {"level": 17.0, "anchor_at": sent},
            "last_interaction_at": sent,
            "last_interaction_hash": "abc",
            "last_signal_at": sent,
            "last_signal_answered_at": None,
        },
    )

    snapshot = desire_drives.read_drives_snapshot(state_dir, now)

    assert snapshot == {
        "last_interaction_at": sent,
        "last_interaction_hash": "abc",
        "last_signal_at": sent,
        "last_signal_answered_at": None,
    }
