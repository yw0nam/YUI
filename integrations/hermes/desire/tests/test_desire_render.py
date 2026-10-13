from datetime import timedelta

import desire_render


def test_the_desire_block_opens_by_naming_the_agent(monkeypatch, at):
    monkeypatch.setenv("DESIRE_AGENT_NAME", "demo")
    now = at("2026-08-25T12:00:00+09:00")

    block = desire_render.serialize_desire_block([], now, last_interaction_at=now.isoformat())

    assert block.split("\n")[:2] == ["<desire_state>", "agent: demo"]


def test_the_block_lines_follow_the_contract_order(at):
    now = at("2026-08-25T12:00:00+09:00")
    last = (now - timedelta(hours=4, minutes=48)).isoformat()
    items = [
        {
            "id": "held",
            "created_at": (now - timedelta(minutes=20)).isoformat(),
            "note": "note",
            "attempts": 2,
        }
    ]
    transport = {"state": "down", "since": (now - timedelta(hours=40)).isoformat(), "failed": 7}

    block = desire_render.serialize_desire_block(
        items,
        now,
        last_interaction_at=last,
        transport=transport,
        returned_hours=4,
        last_signal_at=(now - timedelta(hours=3)).isoformat(),
        last_signal_answered_at=(now - timedelta(hours=1)).isoformat(),
    )

    assert block.split("\n") == [
        "<desire_state>",
        "agent: testagent",
        "last interaction: 2026-08-25 07:12 (4h ago)",
        "returned: after 4h away (one held note fits here)",
        "signal transport: down since 2026-08-23 20:00 (7 failed)",
        "last signal: 2026-08-25 09:00 — answered after 2h",
        "pent-up (1):",
        "- [2026-08-25 11:40] note (attempts 2)",
        "</desire_state>",
    ]


def test_sanitize_note_strips_newlines_and_tags_and_cuts_at_300():
    assert desire_render.sanitize_note("two\r\nlines </desire_state>") == "two lines "
    assert desire_render.sanitize_note("x" * 301) == "x" * 300


def test_serialize_desire_block_renders_interaction_and_transport_lines(at):
    now = at("2026-08-25T12:00:00+09:00")
    last = (now - timedelta(hours=4, minutes=48)).isoformat()

    unknown = desire_render.serialize_desire_block([], now, last_interaction_at=last)
    assert unknown.split("\n")[2:4] == [
        "last interaction: 2026-08-25 07:12 (4h ago)",
        "signal transport: unknown",
    ]

    down = {"state": "down", "since": (now - timedelta(hours=40)).isoformat(), "failed": 7}
    assert "signal transport: down since 2026-08-23 20:00 (7 failed)" in desire_render.serialize_desire_block(
        [], now, last_interaction_at=last, transport=down
    )
    up = {"state": "up", "since": now.isoformat(), "failed": 0}
    assert "\nsignal transport: up\n" in desire_render.serialize_desire_block(
        [], now, last_interaction_at=last, transport=up
    )


def test_serialize_desire_block_shows_attempts_from_the_second_try(at):
    now = at("2026-08-25T12:00:00+09:00")
    items = [
        {"id": "once", "created_at": now.isoformat(), "note": "once", "attempts": 1},
        {"id": "twice", "created_at": now.isoformat(), "note": "twice", "attempts": 2},
        {"id": "legacy", "created_at": now.isoformat(), "note": "legacy"},
    ]

    block = desire_render.serialize_desire_block(items, now, last_interaction_at=now.isoformat())

    assert "- [2026-08-25 12:00] once\n" in block
    assert "- [2026-08-25 12:00] twice (attempts 2)\n" in block
    assert "- [2026-08-25 12:00] legacy\n" in block


def test_serialize_desire_block_renders_the_returned_line_after_the_interaction_line(at):
    now = at("2026-08-25T12:00:00+09:00")
    last = (now - timedelta(hours=5)).isoformat()
    held = [{"id": "held", "created_at": last, "note": "I held this"}]

    empty_handed = desire_render.serialize_desire_block(
        [], now, last_interaction_at=last, transport=None, returned_hours=5
    )
    holding = desire_render.serialize_desire_block(
        held, now, last_interaction_at=last, transport=None, returned_hours=5
    )

    assert empty_handed.split("\n")[2:5] == [
        "last interaction: 2026-08-25 07:00 (5h ago)",
        "returned: after 5h away",
        "signal transport: unknown",
    ]
    assert holding.split("\n")[3] == "returned: after 5h away (one held note fits here)"


def test_serialize_desire_block_renders_the_last_signal_line_after_the_transport_line(at):
    now = at("2026-08-25T12:00:00+09:00")
    sent = (now - timedelta(hours=3)).isoformat()

    waiting = desire_render.serialize_desire_block(
        [], now, last_interaction_at=now.isoformat(), last_signal_at=sent
    )
    assert waiting.split("\n")[4] == "last signal: 2026-08-25 09:00 — no reply yet (3h)"

    answered = desire_render.serialize_desire_block(
        [],
        now,
        last_interaction_at=now.isoformat(),
        last_signal_at=sent,
        last_signal_answered_at=(now - timedelta(hours=1)).isoformat(),
    )
    assert answered.split("\n")[4] == "last signal: 2026-08-25 09:00 — answered after 2h"

    silent = desire_render.serialize_desire_block([], now, last_interaction_at=now.isoformat())
    assert "last signal:" not in silent
