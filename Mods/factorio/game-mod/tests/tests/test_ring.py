import json

import pytest
from conftest import load_module


@pytest.fixture
def ring(lua):
    return load_module(lua, "scripts.ring")


def read_json(lua, table):
    return json.loads(lua.globals().JSON.encode(table))


def test_push_assigns_monotonic_seqs_and_read_returns_events(lua, ring):
    r = ring.new()
    assert ring.push(r, 10, "chat", lua.table(player="a", text="hi")) == 1
    assert ring.push(r, 11, "player_joined", lua.table(player="b")) == 2

    read = ring.read(r, 0, None)
    assert read_json(lua, read) == {
        "events": [
            {"seq": 1, "tick": 10, "kind": "chat", "data": {"player": "a", "text": "hi"}},
            {"seq": 2, "tick": 11, "kind": "player_joined", "data": {"player": "b"}},
        ],
        "head_seq": 2,
        "oldest_seq": 1,
        "gap": False,
    }


def test_read_returns_only_events_after_since_seq(lua, ring):
    r = ring.new()
    ring.push(r, 10, "chat", lua.table(text="a"))
    ring.push(r, 11, "chat", lua.table(text="b"))
    ring.push(r, 12, "chat", lua.table(text="c"))

    read = ring.read(r, 1, None)
    body = read_json(lua, read)
    assert [e["seq"] for e in body["events"]] == [2, 3]
    assert body["head_seq"] == 3


def test_read_limit_returns_the_oldest_matching_events(lua, ring):
    r = ring.new()
    for i in range(1, 6):
        ring.push(r, i, "chat", lua.table(text=str(i)))

    read = ring.read(r, 0, 2)
    body = read_json(lua, read)
    assert [e["seq"] for e in body["events"]] == [1, 2]


def test_ring_holds_2000_then_overflow_reports_history_gap(lua, ring):
    r = ring.new()
    for i in range(1, 2002):
        ring.push(r, i, "chat", lua.table(text=str(i)))

    assert ring.read(r, 0, None)["head_seq"] == 2001
    assert read_json(lua, ring.read(r, 0, None))["oldest_seq"] == 2

    # since < oldest - 1 -> history_gap
    assert ring.read(r, 0, None)["gap"] is True
    assert ring.read(r, 1, None)["gap"] is False

    # exact boundary: since == oldest - 1 is still readable
    readable = ring.read(r, 1, None)
    assert next(e["seq"] for e in read_json(lua, readable)["events"]) == 2


def test_gap_boundary_is_oldest_minus_one(lua, ring):
    r = ring.new()
    for i in range(1, 2005):  # overflow so the oldest seq moves to 5
        ring.push(r, i, "chat", lua.table(text=str(i)))

    assert ring.read(r, 4, None)["gap"] is False
    assert ring.read(r, 3, None)["gap"] is True
