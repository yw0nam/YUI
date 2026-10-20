"""The poll loop pages, rings the doorbell, and hands recovery to its modules."""

import asyncio
import json

from fake_rcon import FakeRconServer

from factorio.events.cache import Session
from factorio.events.poll import Poller
from factorio.outcome_log import OutcomeLog
from factorio.rcon.client import RconClient
from factorio.recovery import MapRecovery
from factorio.rpc import RpcClient, RpcError

CLOCK_S = 1_700_000_000.5
TS = "2023-11-14T22:13:20.500+00:00"


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

    async def run(self, status, *_):
        self.calls.append(status)


class FakeRpc:
    def __init__(self, pages):
        self.pages = list(pages)
        self.calls = []
        self.session = None

    async def status(self):
        self.calls.append(("status", {}))
        reply = self.pages.pop(0)
        if isinstance(reply, Exception):
            raise reply
        self.session.map_id = reply["map_id"]
        return reply

    async def call(self, op, args):
        self.calls.append((op, args))
        page = self.pages.pop(0)
        if isinstance(page, Exception):
            raise page
        return page


def page(map_id: str, head: int, events: list[dict]) -> dict:
    return {"map_id": map_id, "head_seq": head, "events": events}


def event(seq: int, kind: str = "tick") -> dict:
    return {"seq": seq, "tick": seq * 60, "kind": kind, "data": {}}


def make(tmp_path, rpc):
    session = Session()
    rpc.session = session
    doorbell = FakeDoorbell()
    recovery = FakeRecovery()
    log_path = tmp_path / "outcome.jsonl"
    poller = Poller(
        rpc,
        session,
        doorbell,
        recovery,
        OutcomeLog(log_path, clock=lambda: CLOCK_S),
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
    assert [call[0] for call in rpc.calls] == ["status", "events_since", "events_since"]
    assert [record for record in records(log_path) if record["type"] == "history_gap"] == [
        {"ts": TS, "type": "history_gap", "oldest_seq": 60}
    ]


def test_a_rollback_marks_the_doorbell_and_logs_the_cause(tmp_path):
    rpc = FakeRpc(
        [
            {"map_id": "map-a", "seq": 100},
            page("map-a", 95, [event(95)]),
            {"map_id": "map-a", "seq": 95, "queue": {"length": 2}},
        ]
    )
    poller, session, doorbell, _recovery, log_path = make(tmp_path, rpc)
    session.backend_cursor = 98
    asyncio.run(poller.poll_once())
    assert doorbell.resets == 1
    assert [call[0] for call in rpc.calls] == ["status", "events_since", "status"]
    reset = [record for record in records(log_path) if record["type"] == "session_reset"]
    assert reset == [
        {
            "ts": TS,
            "type": "session_reset",
            "cause": "rollback",
            "poll_cursor": 95,
            "backend_cursor": 95,
            "queue_length": 2,
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
            page("map-a", 5001, [event(seq) for seq in range(1, 5002)]),
            page("map-a", 5001, []),
        ]
    )
    poller, _session, _doorbell, _recovery, log_path = make(tmp_path, rpc)
    asyncio.run(poller.poll_once())
    assert [record for record in records(log_path) if record["type"] == "backend_lag"] == [
        {"ts": TS, "type": "backend_lag", "dropped": 1}
    ]


def test_a_poll_and_a_tool_on_the_same_map_change_recover_once(tmp_path):
    statuses = [40, 42]

    def handler(command, count):
        request = json.loads(command.removeprefix("/coop-rpc "))
        head = {"v": 1, "id": request["id"]}
        if request["op"] == "status":
            return json.dumps(
                {
                    **head,
                    "ok": True,
                    "r": {"map_id": "map-b", "seq": statuses.pop(0), "queue": {"length": 2}},
                }
            )
        if request["map_id"] != "map-b":
            return json.dumps({**head, "ok": False, "e": "stale_session", "m": "map_id does not match"})
        if request["op"] == "events_since":
            events = [event(seq) for seq in range(request["args"]["seq"] + 1, 43)]
            return json.dumps(
                {**head, "ok": True, "r": {"map_id": "map-b", "head_seq": 42, "events": events}}
            )
        return json.dumps({**head, "ok": True, "r": {}})

    log_path = tmp_path / "outcome.jsonl"

    async def case():
        server = await FakeRconServer(handler=handler).start()
        try:
            session = Session()
            session.map_id = "map-a"
            log = OutcomeLog(log_path, clock=lambda: CLOCK_S)
            doorbell = FakeDoorbell()
            recovery = MapRecovery(session, doorbell, log)
            rcon = RconClient("127.0.0.1", server.port, "secret", timeout=1.0)
            rpc = RpcClient(rcon, session, recovery.run)
            poller = Poller(rpc, session, doorbell, recovery, log)
            failures = await asyncio.gather(
                rpc.call("say", {"text": "hi"}), poller.poll_once(), return_exceptions=True
            )
            await poller.poll_once()
            return [failure.code for failure in failures], session.read(None, 200)["events"]
        finally:
            await server.close()

    codes, events = asyncio.run(case())
    assert codes == ["stale_session", "stale_session"]
    assert [record for record in records(log_path) if record["type"] == "session_reset"] == [
        {
            "ts": TS,
            "type": "session_reset",
            "cause": "map_change",
            "poll_cursor": 40,
            "backend_cursor": 40,
            "queue_length": 2,
        }
    ]
    assert [e["seq"] for e in events] == [41, 42]


def test_a_request_spanning_two_map_changes_still_adopts_the_last_map(tmp_path):
    session = Session()
    session.map_id = "map-a"
    session.on_map_change({"map_id": "map-a", "seq": 0})
    log_path = tmp_path / "outcome.jsonl"
    recovery = MapRecovery(session, FakeDoorbell(), OutcomeLog(log_path, clock=lambda: CLOCK_S))
    caller_generation = session.generation

    async def case():
        session.map_id = "map-b"
        await recovery.run({"map_id": "map-b", "seq": 10}, caller_generation)
        session.map_id = "map-c"
        await recovery.run({"map_id": "map-c", "seq": 20}, caller_generation)

    asyncio.run(case())
    assert (session.poll_cursor, session.backend_cursor) == (20, 20)
    assert [
        (record["poll_cursor"], record["queue_length"])
        for record in records(log_path)
        if record["type"] == "session_reset"
    ] == [(10, None), (20, None)]
