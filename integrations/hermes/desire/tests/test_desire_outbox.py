import json
from datetime import timedelta

import pytest

import desire_outbox


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

    active = desire_outbox.active_outbox([long_surfaced, exactly_expired, unsurfaced_but_stale], now)

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

    active = desire_outbox.active_outbox([far_future, near_future], now)

    assert active == []


def test_release_outbox_item_preserves_bytes_of_untouched_lines(state_dir):
    path = state_dir / "outbox.jsonl"
    valid_a = json.dumps({"id": "a", "created_at": "2026-08-25T12:00:00+09:00"}).encode("utf-8")
    malformed_crlf = b'{"id": "broken", "created_at": \r\n'
    invalid_utf8 = b"\xff\xfe{broken"
    valid_b = json.dumps({"id": "b", "created_at": "2026-08-25T12:00:00+09:00"}).encode("utf-8")
    original = valid_a + b"\n" + malformed_crlf + b"\n" + invalid_utf8 + b"\n" + valid_b + b"\n"
    path.write_bytes(original)

    assert desire_outbox.release_outbox_item(path, "a") is True

    assert path.read_bytes() == malformed_crlf + b"\n" + invalid_utf8 + b"\n" + valid_b + b"\n"

    assert desire_outbox.release_outbox_item(path, "b") is True

    assert path.read_bytes() == malformed_crlf + b"\n" + invalid_utf8 + b"\n"


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
    assert desire_outbox.pent_up_stage(now - age, now) == expected


def test_valid_outbox_item_accepts_a_not_before_string_only(at):
    now = at("2026-08-25T12:00:00+09:00")
    base = {"id": "one", "created_at": now.isoformat(), "note": "n"}

    assert desire_outbox.valid_outbox_item(base)
    assert desire_outbox.valid_outbox_item({**base, "not_before": now.isoformat()})
    assert not desire_outbox.valid_outbox_item({**base, "not_before": 12})
    assert not desire_outbox.valid_outbox_item({**base, "not_before": "not-a-date"})


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
    assert [value["id"] for value in desire_outbox.visible_outbox(items, now)] == ["plain", "due"]
    later = now + timedelta(hours=1)
    assert [value["id"] for value in desire_outbox.visible_outbox(items, later)] == [
        "plain",
        "due",
        "postponed",
    ]
