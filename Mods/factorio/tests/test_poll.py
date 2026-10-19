"""The poll loop drives the cursor, logs events, and keeps the three recoveries apart."""

import asyncio

from factorio.events.cache import EventCache, Session
from factorio.events.poll import Poller
from factorio.outcome_log import OutcomeLog
from factorio.rpc import RpcError


class FakeDoorbell:
    def __init__(self):
        self.events = []
        self.resets = 0

    def notify(self, event):
        self.events.append(event)

    def mark_reset(self):
        self.resets += 1


class FakeRpc:
    def __init__(self, pages):
        self.pages = list(pages)
        self.calls = []
        self.map_id = None

    async def status(self):
        self.calls.append(("status", {}))
        reply = self.pages.pop(0)
        if isinstance(reply, Exception):
            raise reply
        self.map_id = reply["map_id"]
        return reply

    async def call(self, op, args):
        self.calls.append((op, args))
        page = self.pages.pop(0)
        if isinstance(page, Exception):
            raise page
        return page

    def retry_delay(self):
        return 1.0


def page(map_id: str, head: int, events: list[dict]) -> dict:
    return {"map_id": map_id, "head_seq": head, "events": events}


def event(seq: int, kind: str = "tick") -> dict:
    return {"seq": seq, "tick": seq * 60, "kind": kind, "data": {}}


def make(tmp_path, rpc):
    session = Session()
    cache = EventCache()
    doorbell = FakeDoorbell()
    poller = Poller(
        rpc,
        session,
        cache,
        doorbell,
        OutcomeLog(tmp_path / "outcome.jsonl"),
        interval=0.0,
    )
    return poller, session, cache, doorbell


def test_a_poll_page_advances_the_cursor_and_notifies_the_doorbell(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 0, "mod_version": "0.1.0", "tick": 0, "host": {}},
            page("map-a", 2, [event(1, "chat"), event(2, "job_done")]),
        ]
    )
    poller, session, cache, doorbell = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert (session.map_id, session.poll_cursor, session.backend_cursor) == ("map-a", 2, 0)
    assert [e["seq"] for e in cache.events_after(0)] == [1, 2]
    assert [e["kind"] for e in doorbell.events] == ["chat", "job_done"]


def test_the_loop_keeps_polling_while_a_page_is_full(tmp_path):
    first = page("map-a", 200, [event(seq) for seq in range(1, 201)])
    second = page("map-a", 205, [event(seq) for seq in range(201, 206)])
    rpc = FakeRpc([{"map_id": "map-a", "seq": 0}, first, second])
    poller, session, _cache, _doorbell = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert session.poll_cursor == 205
    assert [call[0] for call in rpc.calls] == ["status", "events_since", "events_since"]


def test_history_gap_rewinds_to_oldest_seq_minus_one(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 100},
            RpcError("history_gap", "", {"oldest_seq": 60}),
            page("map-a", 61, [event(60), event(61)]),
        ]
    )
    poller, session, cache, _doorbell = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert session.poll_cursor == 61
    assert [e["seq"] for e in cache.events_after(0)] == [60, 61]


def test_a_rollback_resets_the_session_and_marks_the_doorbell(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 100},
            page("map-a", 95, [event(95)]),
        ]
    )
    poller, session, _cache, doorbell = make(tmp_path, rpc)
    session.backend_cursor = 98
    asyncio.run(poller.poll_once())
    assert (session.poll_cursor, session.backend_cursor) == (95, 95)
    assert doorbell.resets == 1


def test_a_new_map_id_calls_status_and_clears_the_cache(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 10},
            page("map-b", 3, [event(1), event(2), event(3)]),
            {"map_id": "map-b", "seq": 3},
        ]
    )
    poller, session, cache, doorbell = make(tmp_path, rpc)
    cache.add(event(11))
    asyncio.run(poller.poll_once())
    assert (session.map_id, session.poll_cursor, session.backend_cursor) == ("map-b", 3, 3)
    assert cache.events_after(0) == []
    assert doorbell.resets == 1
    assert [call[0] for call in rpc.calls] == ["status", "events_since", "status"]
