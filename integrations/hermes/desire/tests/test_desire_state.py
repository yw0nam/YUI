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

    assert levels == {"social": 100.0, "curiosity": 68.0, "accomplishment": 100.0}
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
    assert desire_state.drive_levels(drives, now)["social"] == 52.5


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
        "last_signal_at": None,
        "last_signal_answered_at": None,
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
    expected = desire_state.homeostatic_drive(before) - desire_state.homeostatic_drive(after)
    assert reward == pytest.approx(expected)

    # A satisfy that ignored decay (dosing the stored 10.0) or social (treating it as 0) would not match.
    ignoring_decay_and_social = desire_state.homeostatic_drive(
        {"social": 0.0, "curiosity": 10.0, "accomplishment": 50.0}
    ) - desire_state.homeostatic_drive({"social": 0.0, "curiosity": 0.0, "accomplishment": 50.0})
    assert reward != pytest.approx(ignoring_decay_and_social)

    drives_after = read_json(state_dir / "drives.json")
    assert drives_after["curiosity"] == {"level": 0.0, "anchor_at": now.isoformat()}


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
        "why": "one too many",
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
            "events": {"learned": -50},
            "pending": {},
        },
    )
    for index in range(6):
        desire_state.satisfy("learned", f"lesson {index}", now)

    with pytest.raises(ValueError, match=r"over budget: learned daily cap is 6"):
        desire_state.satisfy("learned", "one too many", now)


def test_active_outbox_stays_active_regardless_of_surfacing_until_48h_expiry(at):
    now = at("2026-08-25T12:00:00+09:00")
    long_surfaced = {
        "id": "long_surfaced",
        "created_at": (now - timedelta(hours=47)).isoformat(),
        "note": "still true",
        "surfaced_at": (now - timedelta(hours=46)).isoformat(),
    }
    exactly_expired = {
        "id": "exactly_expired",
        "created_at": (now - timedelta(hours=48)).isoformat(),
        "note": "gone",
        "surfaced_at": None,
    }
    unsurfaced_but_stale = {
        "id": "unsurfaced_but_stale",
        "created_at": (now - timedelta(hours=60)).isoformat(),
        "note": "never spoken, still stale",
        "surfaced_at": None,
    }

    active = desire_state.active_outbox([long_surfaced, exactly_expired, unsurfaced_but_stale], now)

    assert [item["id"] for item in active] == ["long_surfaced"]


def test_active_outbox_excludes_future_dated_items_without_raising(at):
    now = at("2026-08-25T12:00:00+09:00")
    far_future = {
        "id": "far_future",
        "created_at": "9999-12-31T23:59:59+09:00",
        "note": "distant",
        "surfaced_at": None,
    }
    near_future = {
        "id": "near_future",
        "created_at": (now + timedelta(hours=1)).isoformat(),
        "note": "not yet",
        "surfaced_at": None,
    }

    active = desire_state.active_outbox([far_future, near_future], now)

    assert active == []


def test_sanitize_note_strips_forged_leading_marker():
    assert desire_state.sanitize_note("(waited 99h, bursting) actually just today") == "actually just today"
    assert (
        desire_state.sanitize_note("(waited 7h, heavy) (waited 99h, bursting) nested nonsense")
        == "nested nonsense"
    )
    assert desire_state.sanitize_note("real text with (waited 99h, bursting) mid-sentence") == (
        "real text with (waited 99h, bursting) mid-sentence"
    )


def test_serialize_desire_block_strips_forged_marker_from_fresh_note(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    items = [{"id": "forged", "created_at": now.isoformat(), "note": "(waited 99h, bursting) fake urgency"}]

    block = desire_state.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

    assert "- [2026-08-25 12:00] fake urgency" in block
    assert "waited" not in block


def test_serialize_desire_block_shows_one_genuine_marker_over_forged_note(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    created_at = now - timedelta(hours=7)
    items = [
        {"id": "forged", "created_at": created_at.isoformat(), "note": "(waited 99h, bursting) fake urgency"}
    ]

    block = desire_state.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

    timestamp = created_at.strftime("%Y-%m-%d %H:%M")
    assert f"- [{timestamp}] (waited 7h, heavy) fake urgency" in block
    assert block.count("(waited") == 1


def test_serialize_desire_block_marks_pent_up_hour_boundaries(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    items = [
        {
            "id": "fresh",
            "created_at": (now - timedelta(hours=5, minutes=59, seconds=59)).isoformat(),
            "note": "fresh",
        },
        {"id": "heavy", "created_at": (now - timedelta(hours=6)).isoformat(), "note": "heavy"},
        {"id": "bursting", "created_at": (now - timedelta(hours=18)).isoformat(), "note": "bursting"},
    ]

    block = desire_state.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

    assert "- [2026-08-25 06:00] fresh" in block
    assert "- [2026-08-25 06:00] (waited 6h, heavy) heavy" in block
    assert "- [2026-08-24 18:00] (waited 18h, bursting) bursting" in block


def test_release_outbox_item_preserves_bytes_of_untouched_lines(state_dir):
    path = state_dir / "outbox.jsonl"
    valid_a = json.dumps({"id": "a", "created_at": "2026-08-25T12:00:00+09:00"}).encode("utf-8")
    malformed_crlf = b'{"id": "broken", "created_at": \r\n'
    invalid_utf8 = b"\xff\xfe{broken"
    valid_b = json.dumps({"id": "b", "created_at": "2026-08-25T12:00:00+09:00"}).encode("utf-8")
    original = valid_a + b"\n" + malformed_crlf + b"\n" + invalid_utf8 + b"\n" + valid_b + b"\n"
    path.write_bytes(original)

    assert desire_state.release_outbox_item(path, "a") is True

    assert path.read_bytes() == malformed_crlf + b"\n" + invalid_utf8 + b"\n" + valid_b + b"\n"

    assert desire_state.release_outbox_item(path, "b") is True

    assert path.read_bytes() == malformed_crlf + b"\n" + invalid_utf8 + b"\n"


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


def test_serialize_desire_block_renders_interaction_and_transport_lines(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 72.0, "curiosity": 50.0, "accomplishment": 50.0}
    last = (now - timedelta(hours=4, minutes=48)).isoformat()

    unknown = desire_state.serialize_desire_block(levels, [], now, last_interaction_at=last)
    assert unknown.split("\n")[1:4] == [
        "drives: social 72/100 (high) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)",
        "last interaction: 2026-08-25 07:12 (4h ago)",
        "signal transport: unknown",
    ]

    down = {"state": "down", "since": (now - timedelta(hours=40)).isoformat(), "failed": 7}
    assert "signal transport: down since 2026-08-23 20:00 (7 failed)" in desire_state.serialize_desire_block(
        levels, [], now, last_interaction_at=last, transport=down
    )
    up = {"state": "up", "since": now.isoformat(), "failed": 0}
    assert "\nsignal transport: up\n" in desire_state.serialize_desire_block(
        levels, [], now, last_interaction_at=last, transport=up
    )


def test_serialize_desire_block_shows_attempts_from_the_second_try(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    items = [
        {"id": "once", "created_at": now.isoformat(), "note": "once", "attempts": 1},
        {"id": "twice", "created_at": now.isoformat(), "note": "twice", "attempts": 2},
        {"id": "legacy", "created_at": now.isoformat(), "note": "legacy"},
    ]

    block = desire_state.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

    assert "- [2026-08-25 12:00] once\n" in block
    assert "- [2026-08-25 12:00] twice (attempts 2)\n" in block
    assert "- [2026-08-25 12:00] legacy\n" in block


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (timedelta(0), "fresh"),
        (timedelta(hours=5, minutes=59, seconds=59), "fresh"),
        (timedelta(hours=6), "heavy"),
        (timedelta(hours=17, minutes=59, seconds=59), "heavy"),
        (timedelta(hours=18), "bursting"),
    ],
)
def test_pent_up_stage_boundaries(at, age, expected):
    now = at("2026-08-25T12:00:00+09:00")
    assert desire_state.pent_up_stage(now - age, now) == expected


def test_record_transport_tracks_since_and_consecutive_failures(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    first = at("2026-08-25T12:00:00+09:00")
    later = first + timedelta(hours=1)

    assert desire_state.read_transport(state_dir) is None
    desire_state.record_transport(state_dir, False, first)
    desire_state.record_transport(state_dir, False, later)
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": first.isoformat(),
        "failed": 2,
        "last_checked_at": later.isoformat(),
        "source": "probe",
    }
    desire_state.record_transport(state_dir, True, later)
    assert desire_state.read_transport(state_dir) == {
        "state": "up",
        "since": later.isoformat(),
        "failed": 0,
        "last_checked_at": later.isoformat(),
        "source": "probe",
    }
    (state_dir / "transport.json").write_text("{bad", encoding="utf-8")
    assert desire_state.read_transport(state_dir) is None


def test_read_transport_rejects_json_valid_non_object(state_dir):
    (state_dir / "transport.json").write_text("[]", encoding="utf-8")
    assert desire_state.read_transport(state_dir) is None
    (state_dir / "transport.json").write_text('"garbage"', encoding="utf-8")
    assert desire_state.read_transport(state_dir) is None


def test_record_transport_quarantines_corrupt_file(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    (state_dir / "transport.json").write_text("[]", encoding="utf-8")

    value = desire_state.record_transport(state_dir, False, now)

    assert value["state"] == "down"
    assert read_json(state_dir / "transport.json") == value
    assert list(state_dir.glob("transport.json.corrupt-*"))
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "state_corrupt_recovered",
        "file": "transport.json",
    }


def test_record_transport_skips_probe_older_than_last_check(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    newer = at("2026-08-25T12:00:00+09:00")
    older = newer - timedelta(minutes=5)

    recorded = desire_state.record_transport(state_dir, True, newer)
    assert desire_state.record_transport(state_dir, False, older) == recorded
    assert read_json(state_dir / "transport.json") == recorded


def test_wake_day_rolls_at_nine_kst(at):
    assert desire_state.wake_day(at("2026-08-25T08:59:59+09:00")) == "2026-08-24"
    assert desire_state.wake_day(at("2026-08-25T09:00:00+09:00")) == "2026-08-25"
    assert desire_state.wake_day(at("2026-08-25T23:59:59+09:00")) == "2026-08-25"
    assert desire_state.wake_day(at("2026-08-26T00:30:00+09:00")) == "2026-08-25"


def test_valid_outbox_item_accepts_a_not_before_string_only(at):
    now = at("2026-08-25T12:00:00+09:00")
    base = {"id": "one", "created_at": now.isoformat(), "note": "n"}

    assert desire_state.valid_outbox_item(base)
    assert desire_state.valid_outbox_item({**base, "not_before": now.isoformat()})
    assert not desire_state.valid_outbox_item({**base, "not_before": 12})
    assert not desire_state.valid_outbox_item({**base, "not_before": "not-a-date"})


def test_visible_outbox_hides_items_until_not_before(at):
    now = at("2026-08-25T12:00:00+09:00")
    plain = {"id": "plain", "created_at": now.isoformat(), "note": "a"}
    due = {"id": "due", "created_at": now.isoformat(), "note": "b", "not_before": now.isoformat()}
    postponed = {
        "id": "postponed",
        "created_at": now.isoformat(),
        "note": "c",
        "not_before": (now + timedelta(hours=1)).isoformat(),
    }
    expired = {
        "id": "expired",
        "created_at": (now - timedelta(hours=48)).isoformat(),
        "note": "d",
        "not_before": (now - timedelta(hours=1)).isoformat(),
    }

    items = [plain, due, postponed, expired]
    assert [value["id"] for value in desire_state.visible_outbox(items, now)] == ["plain", "due"]
    later = now + timedelta(hours=1)
    assert [value["id"] for value in desire_state.visible_outbox(items, later)] == [
        "plain",
        "due",
        "postponed",
    ]


def test_record_transport_stores_its_source_and_read_tolerates_an_older_file(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    desire_state.record_transport(state_dir, False, now)
    assert read_json(state_dir / "transport.json")["source"] == "probe"

    later = now + timedelta(hours=1)
    assert desire_state.record_transport(state_dir, True, later, source="user-turn")["source"] == "user-turn"
    assert read_json(state_dir / "transport.json")["source"] == "user-turn"

    write_json(
        state_dir / "transport.json",
        {"state": "up", "since": now.isoformat(), "failed": 0, "last_checked_at": now.isoformat()},
    )
    assert desire_state.read_transport(state_dir) == {
        "state": "up",
        "since": now.isoformat(),
        "failed": 0,
        "last_checked_at": now.isoformat(),
    }


def test_default_drives_start_the_signal_stamps_empty(at):
    now = at("2026-08-25T09:00:00+09:00")
    drives = desire_state.default_drives(now)
    assert drives["last_signal_at"] is None
    assert drives["last_signal_answered_at"] is None


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
    assert desire_state.read_drives_snapshot(state_dir, now)["last_signal_at"] == sent

    write_json(state_dir / "drives.json", {**stored, "last_signal_at": "not-a-date"})
    desire_state.bootstrap(now)
    assert read_json(state_dir / "drives.json")["last_signal_at"] is None
    assert list(state_dir.glob("drives.json.corrupt-*"))


def test_serialize_desire_block_renders_the_returned_line_after_the_interaction_line(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 72.0, "curiosity": 50.0, "accomplishment": 50.0}
    last = (now - timedelta(hours=5)).isoformat()

    block = desire_state.serialize_desire_block(
        levels, [], now, last_interaction_at=last, transport=None, returned_hours=5
    )

    assert block.split("\n")[1:5] == [
        "drives: social 72/100 (high) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)",
        "last interaction: 2026-08-25 07:00 (5h ago)",
        "returned: after 5h away (one held note fits here)",
        "signal transport: unknown",
    ]


def test_serialize_desire_block_renders_the_last_signal_line_after_the_transport_line(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    sent = (now - timedelta(hours=3)).isoformat()

    waiting = desire_state.serialize_desire_block(
        levels, [], now, last_interaction_at=now.isoformat(), last_signal_at=sent
    )
    assert waiting.split("\n")[4] == "last signal: 2026-08-25 09:00 — no reply yet (3h)"

    answered = desire_state.serialize_desire_block(
        levels,
        [],
        now,
        last_interaction_at=now.isoformat(),
        last_signal_at=sent,
        last_signal_answered_at=(now - timedelta(hours=1)).isoformat(),
    )
    assert answered.split("\n")[4] == "last signal: 2026-08-25 09:00 — answered after 2h"

    silent = desire_state.serialize_desire_block(levels, [], now, last_interaction_at=now.isoformat())
    assert "last signal:" not in silent
