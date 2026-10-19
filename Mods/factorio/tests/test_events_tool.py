"""factorio_events: the unread cursor, clamping, re-reads, paging, and forward-only reads."""

import asyncio

from factorio.events.cache import EventCache, Session
from factorio.outcome_log import OutcomeLog
from factorio.tools import read


def event(seq: int) -> dict:
    return {"seq": seq, "tick": seq * 60, "kind": "tick", "data": {}}


def configured(tmp_path, count: int = 250):
    cache = EventCache()
    for seq in range(1, count + 1):
        cache.add(event(seq))
    session = Session()
    session.on_map_change({"map_id": "map-a", "seq": 0})
    read.configure(rpc=None, session=session, cache=cache, log=OutcomeLog(tmp_path / "outcome.jsonl"))
    return session, cache


def test_the_default_read_starts_at_the_backend_cursor(tmp_path):
    session, _cache = configured(tmp_path, count=5)
    session.backend_cursor = 3
    result = asyncio.run(read.factorio_events())
    assert [e["seq"] for e in result["events"]] == [4, 5]
    assert (result["next_seq"], result["more"]) == (5, False)


def test_a_page_of_200_reports_more_and_moves_the_cursor(tmp_path):
    session, _cache = configured(tmp_path)
    first = asyncio.run(read.factorio_events())
    assert len(first["events"]) == 200
    assert (first["next_seq"], first["more"]) == (200, True)
    assert session.backend_cursor == 200
    second = asyncio.run(read.factorio_events())
    assert len(second["events"]) == 50
    assert (second["next_seq"], second["more"]) == (250, False)
    assert session.backend_cursor == 250


def test_a_since_above_the_cursor_is_clamped_down(tmp_path):
    session, _cache = configured(tmp_path, count=5)
    session.backend_cursor = 3
    result = asyncio.run(read.factorio_events(since_seq=999))
    assert [e["seq"] for e in result["events"]] == [4, 5]
    assert (result["next_seq"], result["more"]) == (5, False)
    assert session.backend_cursor == 5


def test_a_since_below_the_cursor_re_reads_without_moving_it_backward(tmp_path):
    session, _cache = configured(tmp_path, count=250)
    session.backend_cursor = 250
    result = asyncio.run(read.factorio_events(since_seq=100))
    assert [e["seq"] for e in result["events"]] == list(range(101, 251))
    assert (result["next_seq"], result["more"]) == (250, False)
    assert session.backend_cursor == 250


def test_limit_is_capped_at_200(tmp_path):
    session, _cache = configured(tmp_path)
    result = asyncio.run(read.factorio_events(limit=500))
    assert len(result["events"]) == 200
    assert session.backend_cursor == 200
