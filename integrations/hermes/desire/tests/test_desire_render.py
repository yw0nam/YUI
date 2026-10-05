from datetime import timedelta

import desire_render


def test_the_desire_block_opens_by_naming_the_agent(monkeypatch, at):
    monkeypatch.setenv("DESIRE_AGENT_NAME", "demo")
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}

    block = desire_render.serialize_desire_block(levels, [], now, last_interaction_at=now.isoformat())

    assert block.split("\n")[:2] == ["<desire_state>", "agent: demo"]


def test_sanitize_note_strips_forged_leading_marker():
    assert desire_render.sanitize_note("(waited 99h, bursting) actually just today") == "actually just today"
    assert (
        desire_render.sanitize_note("(waited 7h, heavy) (waited 99h, bursting) nested nonsense")
        == "nested nonsense"
    )
    assert desire_render.sanitize_note("real text with (waited 99h, bursting) mid-sentence") == (
        "real text with (waited 99h, bursting) mid-sentence"
    )


def test_serialize_desire_block_strips_forged_marker_from_fresh_note(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    items = [{"id": "forged", "created_at": now.isoformat(), "note": "(waited 99h, bursting) fake urgency"}]

    block = desire_render.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

    assert "- [2026-08-25 12:00] fake urgency" in block
    assert "waited" not in block


def test_serialize_desire_block_shows_one_genuine_marker_over_forged_note(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    created_at = now - timedelta(hours=7)
    items = [
        {"id": "forged", "created_at": created_at.isoformat(), "note": "(waited 99h, bursting) fake urgency"}
    ]

    block = desire_render.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

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

    block = desire_render.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

    assert "- [2026-08-25 06:00] fresh" in block
    assert "- [2026-08-25 06:00] (waited 6h, heavy) heavy" in block
    assert "- [2026-08-24 18:00] (waited 18h, bursting) bursting" in block


def test_serialize_desire_block_renders_interaction_and_transport_lines(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 72.0, "curiosity": 50.0, "accomplishment": 50.0}
    last = (now - timedelta(hours=4, minutes=48)).isoformat()

    unknown = desire_render.serialize_desire_block(levels, [], now, last_interaction_at=last)
    assert unknown.split("\n")[2:5] == [
        "drives: social 72/100 (high) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)",
        "last interaction: 2026-08-25 07:12 (4h ago)",
        "signal transport: unknown",
    ]

    down = {"state": "down", "since": (now - timedelta(hours=40)).isoformat(), "failed": 7}
    assert "signal transport: down since 2026-08-23 20:00 (7 failed)" in desire_render.serialize_desire_block(
        levels, [], now, last_interaction_at=last, transport=down
    )
    up = {"state": "up", "since": now.isoformat(), "failed": 0}
    assert "\nsignal transport: up\n" in desire_render.serialize_desire_block(
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

    block = desire_render.serialize_desire_block(levels, items, now, last_interaction_at=now.isoformat())

    assert "- [2026-08-25 12:00] once\n" in block
    assert "- [2026-08-25 12:00] twice (attempts 2)\n" in block
    assert "- [2026-08-25 12:00] legacy\n" in block


def test_serialize_desire_block_renders_the_returned_line_after_the_interaction_line(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 72.0, "curiosity": 50.0, "accomplishment": 50.0}
    last = (now - timedelta(hours=5)).isoformat()
    held = [{"id": "held", "created_at": last, "note": "I held this"}]

    empty_handed = desire_render.serialize_desire_block(
        levels, [], now, last_interaction_at=last, transport=None, returned_hours=5
    )
    holding = desire_render.serialize_desire_block(
        levels, held, now, last_interaction_at=last, transport=None, returned_hours=5
    )

    assert empty_handed.split("\n")[2:6] == [
        "drives: social 72/100 (high) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)",
        "last interaction: 2026-08-25 07:00 (5h ago)",
        "returned: after 5h away",
        "signal transport: unknown",
    ]
    assert holding.split("\n")[4] == "returned: after 5h away (one held note fits here)"


def test_serialize_desire_block_renders_the_last_signal_line_after_the_transport_line(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    sent = (now - timedelta(hours=3)).isoformat()

    waiting = desire_render.serialize_desire_block(
        levels, [], now, last_interaction_at=now.isoformat(), last_signal_at=sent
    )
    assert waiting.split("\n")[5] == "last signal: 2026-08-25 09:00 — no reply yet (3h)"

    answered = desire_render.serialize_desire_block(
        levels,
        [],
        now,
        last_interaction_at=now.isoformat(),
        last_signal_at=sent,
        last_signal_answered_at=(now - timedelta(hours=1)).isoformat(),
    )
    assert answered.split("\n")[5] == "last signal: 2026-08-25 09:00 — answered after 2h"

    silent = desire_render.serialize_desire_block(levels, [], now, last_interaction_at=now.isoformat())
    assert "last signal:" not in silent


def test_serialize_desire_block_renders_the_since_last_turn_line_after_the_transport_line(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    unreported = [
        {"event": "progressed", "kind": "pr", "ref": "https://github.com/owner/YUI/pull/12"},
        {"event": "shipped", "kind": "issue", "ref": "https://github.com/owner/YUI/issues/7"},
    ]

    block = desire_render.serialize_desire_block(
        levels, [], now, last_interaction_at=now.isoformat(), unreported=unreported
    )

    assert block.split("\n")[5] == (
        "since last turn: progressed pr https://github.com/owner/YUI/pull/12; "
        "shipped issue https://github.com/owner/YUI/issues/7"
    )
    one = desire_render.serialize_desire_block(
        levels, [], now, last_interaction_at=now.isoformat(), unreported=unreported[1:]
    )
    assert one.split("\n")[5] == "since last turn: shipped issue https://github.com/owner/YUI/issues/7"
    assert "since last turn:" not in desire_render.serialize_desire_block(
        levels, [], now, last_interaction_at=now.isoformat(), unreported=[]
    )


def test_since_last_turn_line_caps_the_listed_artefacts_and_drops_unknown_entries(at):
    now = at("2026-08-25T12:00:00+09:00")
    levels = {"social": 0.0, "curiosity": 50.0, "accomplishment": 50.0}
    unreported = [{"event": "progressed", "kind": "skill", "ref": f"skill/{index}"} for index in range(11)]
    unreported.append({"event": "invented", "kind": "skill", "ref": "skill/x"})
    unreported.append({"event": "progressed", "kind": "wish", "ref": "skill/y"})

    block = desire_render.serialize_desire_block(
        levels, [], now, last_interaction_at=now.isoformat(), unreported=unreported
    )

    line = block.split("\n")[5]
    assert line.startswith("since last turn: progressed skill skill/0; ")
    assert line.endswith("; progressed skill skill/7; and 3 more")
    assert "skill/x" not in line
    assert "skill/y" not in line
