"""Event cache and session cursors: forward-only, rollback, history gap, map change."""

from factorio.events.cache import EventCache, Session


def event(seq: int, kind: str = "tick", data: dict | None = None) -> dict:
    return {"seq": seq, "tick": seq * 60, "kind": kind, "data": data or {}}


def page(map_id: str, head_seq: int, events: list[dict] | None = None) -> dict:
    return {"map_id": map_id, "head_seq": head_seq, "events": events or []}


def session_at(map_id: str, cursor: int) -> Session:
    session = Session()
    session.on_map_change({"map_id": map_id, "seq": cursor})
    return session


def test_a_normal_page_moves_only_the_poll_cursor():
    session = session_at("map-a", 10)
    cache = EventCache()
    result = session.on_page(page("map-a", 13, [event(11), event(12), event(13)]), cache)
    assert result.outcome == "ok"
    assert (session.poll_cursor, session.backend_cursor) == (13, 10)
    assert [e["seq"] for e in cache.events_after(0)] == [11, 12, 13]


def test_history_gap_rewinds_the_poll_cursor_to_oldest_seq_minus_one():
    session = session_at("map-a", 100)
    session.on_history_gap(80)
    assert session.poll_cursor == 79
    assert session.backend_cursor == 100


def test_rollback_resets_both_cursors_and_drops_events_above_head_seq():
    session = session_at("map-a", 90)
    session.poll_cursor = 100
    cache = EventCache()
    for seq in range(91, 101):
        cache.add(event(seq))
    result = session.on_page(
        page("map-a", 95, [event(91), event(92), event(93), event(94), event(95)]), cache
    )
    assert result.outcome == "rollback"
    assert (session.poll_cursor, session.backend_cursor) == (95, 90)
    assert [e["seq"] for e in cache.events_after(0)] == [91, 92, 93, 94, 95]


def test_rollback_never_moves_the_read_cursor_forward():
    session = session_at("map-a", 98)
    session.poll_cursor = 100
    result = session.on_page(page("map-a", 95, []), EventCache())
    assert result.outcome == "rollback"
    assert (session.poll_cursor, session.backend_cursor) == (95, 95)


def test_a_new_map_id_reports_map_change_without_touching_the_cursors():
    session = session_at("map-a", 50)
    cache = EventCache()
    cache.add(event(51))
    result = session.on_page(page("map-b", 3, [event(1)]), cache)
    assert result.outcome == "map_change"
    assert (session.map_id, session.poll_cursor, session.backend_cursor) == ("map-a", 50, 50)
    assert [e["seq"] for e in cache.events_after(0)] == [51]


def test_adopting_a_status_resets_cursors_and_clears_the_cache():
    session = session_at("map-a", 50)
    cache = EventCache()
    cache.add(event(51))
    session.on_map_change({"map_id": "map-b", "seq": 7}, cache)
    assert (session.map_id, session.poll_cursor, session.backend_cursor) == ("map-b", 7, 7)
    assert cache.events_after(0) == []


def test_the_cache_drops_the_oldest_event_past_its_capacity():
    cache = EventCache(capacity=2)
    assert cache.add(event(1)) == ()
    assert cache.add(event(2)) == ()
    assert cache.add(event(3)) == (1,)
    assert [e["seq"] for e in cache.events_after(0)] == [2, 3]


def test_a_page_stops_at_the_first_sequence_gap():
    cache = EventCache()
    for seq in (1, 2, 4):
        cache.add(event(seq))
    session = session_at("map-a", 0)
    assert [e["seq"] for e in session.read(cache, None, 10)["events"]] == [1, 2]
