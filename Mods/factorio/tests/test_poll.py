"""The poll loop pages, rings the doorbell, and hands recovery to its modules."""

import asyncio
import json

import pytest

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


class FakeRecovery:
    def __init__(self):
        self.calls = []

    async def run(self, status):
        self.calls.append(status)


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


def make(tmp_path, rpc, capacity: int = 5000):
    session = Session(EventCache(capacity=capacity))
    doorbell = FakeDoorbell()
    recovery = FakeRecovery()
    log_path = tmp_path / "outcome.jsonl"
    poller = Poller(
        rpc,
        session,
        doorbell,
        recovery,
        OutcomeLog(log_path),
        interval=0.0,
    )
    return poller, session, doorbell, recovery, log_path


def records(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_a_poll_page_logs_and_notifies_the_doorbell(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 0, "mod_version": "0.1.0", "tick": 0, "host": {}},
            page("map-a", 2, [event(1, "chat"), event(2, "job_done")]),
        ]
    )
    poller, _session, doorbell, _recovery, log_path = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert [call[0] for call in rpc.calls] == ["status", "events_since"]
    assert [e["kind"] for e in doorbell.events] == ["chat", "job_done"]
    assert [record["event"]["seq"] for record in records(log_path) if record["type"] == "event"] == [1, 2]


def test_the_loop_keeps_polling_while_a_page_is_full(tmp_path):
    first = page("map-a", 200, [event(seq) for seq in range(1, 201)])
    second = page("map-a", 205, [event(seq) for seq in range(201, 206)])
    rpc = FakeRpc([{"map_id": "map-a", "seq": 0}, first, second])
    poller, _session, _doorbell, _recovery, _log = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert [call[0] for call in rpc.calls] == ["status", "events_since", "events_since"]


def test_history_gap_is_logged_and_the_page_is_retried(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 100},
            RpcError("history_gap", "", {"oldest_seq": 60}),
            page("map-a", 61, [event(60), event(61)]),
        ]
    )
    poller, _session, _doorbell, _recovery, log_path = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert rpc.calls[-1] == ("events_since", {"seq": 59, "limit": 200})
    assert any(record["type"] == "history_gap" and record["oldest_seq"] == 60 for record in records(log_path))


def test_a_rollback_marks_the_doorbell_and_logs_the_cause(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 100},
            page("map-a", 95, [event(95)]),
        ]
    )
    poller, session, doorbell, _recovery, log_path = make(tmp_path, rpc)
    session.backend_cursor = 98
    asyncio.run(poller.poll_once())
    assert doorbell.resets == 1
    reset = [record for record in records(log_path) if record["type"] == "session_reset"]
    assert reset == [
        {
            "ts": reset[0]["ts"],
            "type": "session_reset",
            "cause": "rollback",
            "poll_cursor": 95,
            "backend_cursor": 95,
        }
    ]


def test_a_new_map_id_calls_status_and_the_recovery(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 10},
            page("map-b", 3, [event(1), event(2), event(3)]),
            {"map_id": "map-b", "seq": 3},
        ]
    )
    poller, _session, _doorbell, recovery, _log = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert [call[0] for call in rpc.calls] == ["status", "events_since", "status"]
    assert recovery.calls == [{"map_id": "map-b", "seq": 3}]


def test_backend_lag_is_logged_when_an_unread_event_is_dropped(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 0},
            page("map-a", 3, [event(1), event(2), event(3)]),
        ]
    )
    poller, _session, _doorbell, _recovery, log_path = make(tmp_path, rpc, capacity=2)
    asyncio.run(poller.poll_once())
    assert any(record["type"] == "backend_lag" and record["dropped"] == 1 for record in records(log_path))


@pytest.mark.parametrize(
    "status",
    [
        {"map_id": "map-a", "seq": 0, "host": {"name": "Ada"}},
        {"map_id": "map-a", "seq": 0},
    ],
)
def test_a_status_with_or_without_a_host_starts_the_poll(tmp_path, status):
    rpc = FakeRpc([status, page("map-a", 1, [event(1)])])
    poller, session, doorbell, _recovery, _log = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert session.map_id == "map-a"
    assert [e["seq"] for e in doorbell.events] == [1]
