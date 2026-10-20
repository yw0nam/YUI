"""RPC: request shape, reply parsing, stale-session recovery, id conflicts, replay."""

import asyncio
import json

import pytest
from fake_rcon import CLOSE, FakeRconServer

from factorio.events.cache import Session
from factorio.rcon.client import RconClient
from factorio.rpc import RpcClient, RpcError, RpcProtocolError, RpcUnavailable


def parse(command: str) -> dict:
    return json.loads(command.removeprefix("/coop-rpc "))


def reply(request: dict, *, ok: bool = True, r=None, e=None, m=None) -> str:
    body = {"v": 1, "id": request["id"], "ok": ok}
    if ok:
        body["r"] = r
    else:
        body["e"] = e
        if m is not None:
            body["m"] = m
    return json.dumps(body)


async def no_sleep(_delay: float) -> None:
    return None


async def with_server(handler, body, **kwargs):
    server = await FakeRconServer(handler=handler).start()
    try:
        rcon = RconClient("127.0.0.1", server.port, "secret", timeout=1.0)
        kwargs.setdefault("sleep", no_sleep)
        session = Session()
        return await body(RpcClient(rcon, session, **kwargs), session)
    finally:
        await server.close()


def test_status_omits_map_id_and_the_next_call_carries_it():
    requests = []

    def handler(command, count):
        request = parse(command)
        requests.append(request)
        if request["op"] == "status":
            return reply(
                request, r={"mod_version": "0.1.0", "map_id": "map-a", "seq": 5, "tick": 0, "host": {}}
            )
        return reply(request, r={"ok": True})

    async def body(rpc, session):
        status = await rpc.status()
        await rpc.call("say", {"text": "hi"})
        return status

    status = asyncio.run(with_server(handler, body))
    assert status["map_id"] == "map-a"
    assert "map_id" not in requests[0]
    assert requests[1]["map_id"] == "map-a"
    assert requests[1]["op"] == "say"
    assert requests[1]["args"] == {"text": "hi"}


def test_stale_session_runs_the_recovery_and_does_not_rerun_the_op():
    requests = []
    recovered = []

    def handler(command, count):
        request = parse(command)
        requests.append(request)
        if request["op"] == "status":
            return reply(request, r={"map_id": "map-b", "seq": 40, "tick": 0})
        if request["map_id"] == "map-a":
            return reply(request, ok=False, e="stale_session")
        return reply(request, r={"said": True})

    async def on_reset(_rpc, status, *_):
        recovered.append(status)

    async def body(rpc, session):
        session.map_id = "map-a"
        with pytest.raises(RpcError) as raised:
            await rpc.call("say", {"text": "hi"})
        return raised.value.code

    assert asyncio.run(with_server(handler, body, on_session_reset=on_reset)) == "stale_session"
    says = [request for request in requests if request["op"] == "say"]
    assert len(says) == 1
    assert [status["map_id"] for status in recovered] == ["map-b"]


def test_an_id_conflict_on_a_replay_raises_and_sends_nothing_more():
    requests = []

    def handler(command, count):
        request = parse(command)
        requests.append(request)
        if request["op"] == "status":
            return reply(request, r={"map_id": "map-a", "seq": 0})
        if len([item for item in requests if item["op"] == "say"]) == 1:
            return CLOSE
        return reply(request, ok=False, e="id_conflict", m="id already used with different arguments")

    async def body(rpc, session):
        session.map_id = "map-a"
        with pytest.raises(RpcError) as raised:
            await rpc.call("say", {"text": "hi"})
        return raised.value.code, raised.value.message

    assert asyncio.run(with_server(handler, body)) == (
        "id_conflict",
        "id already used with different arguments",
    )
    says = [request for request in requests if request["op"] == "say"]
    assert [request["id"] for request in says] == [says[0]["id"], says[0]["id"]]


def test_an_unknown_outcome_reconciles_and_resends_the_identical_id():
    requests = []

    def handler(command, count):
        request = parse(command)
        requests.append(request)
        if request["op"] == "status":
            return reply(request, r={"map_id": "map-a", "seq": 0})
        if len([item for item in requests if item["op"] == "say"]) == 1:
            return CLOSE
        return reply(request, r={"said": True})

    async def body(rpc, session):
        session.map_id = "map-a"
        return await rpc.call("say", {"text": "hi"})

    assert asyncio.run(with_server(handler, body)) == {"said": True}
    says = [request for request in requests if request["op"] == "say"]
    assert [request["id"] for request in says] == [says[0]["id"], says[0]["id"]]
    assert [request["args"] for request in says] == [{"text": "hi"}, {"text": "hi"}]


def test_an_unknown_outcome_after_a_map_change_recovers_and_raises():
    recovered = []

    def handler(command, count):
        request = parse(command)
        if request["op"] == "status":
            return reply(request, r={"map_id": "map-b", "seq": 40})
        return CLOSE

    async def on_reset(_rpc, status, *_):
        recovered.append(status)

    async def body(rpc, session):
        session.map_id = "map-a"
        with pytest.raises(RpcUnavailable) as raised:
            await rpc.call("say", {"text": "hi"})
        return raised.value.code

    assert asyncio.run(with_server(handler, body, on_session_reset=on_reset)) == "unknown_outcome"
    assert [status["map_id"] for status in recovered] == ["map-b"]


def test_an_unknown_outcome_stops_after_the_budget():
    now = [0.0]

    async def sleep(delay: float) -> None:
        now[0] += delay

    def handler(command, count):
        request = parse(command)
        if request["op"] == "status":
            return reply(request, r={"map_id": "map-a", "seq": 0})
        return CLOSE

    async def body(rpc, session):
        session.map_id = "map-a"
        with pytest.raises(RpcUnavailable) as raised:
            await rpc.call("say", {"text": "hi"})
        return raised.value.code

    code = asyncio.run(with_server(handler, body, clock=lambda: now[0], sleep=sleep))
    assert code == "unknown_outcome"
    assert now[0] == 60.0


def test_an_error_reply_raises_the_error_code_and_message():
    def handler(command, count):
        return reply(parse(command), ok=False, e="too_large", m="reply over 64 KiB")

    async def body(rpc, session):
        await rpc.call("snapshot", {})

    with pytest.raises(RpcError) as raised:
        asyncio.run(with_server(handler, body))
    assert (raised.value.code, raised.value.message) == ("too_large", "reply over 64 KiB")


@pytest.mark.parametrize(
    "raw",
    [
        "this is not json",
        '["v", 1]',
        '{"v": 1, "id": "x"} trailing',
    ],
)
def test_a_reply_that_is_not_one_json_object_raises_a_protocol_error(raw):
    async def body(rpc, session):
        await rpc.call("status", {})

    with pytest.raises(RpcProtocolError, match="not one JSON object"):
        asyncio.run(with_server(lambda command, count: raw, body))


@pytest.mark.parametrize(
    ("fields", "error", "code", "message"),
    [
        (
            {"id": None, "ok": False, "e": "bad_request", "m": "parameter must be one JSON object"},
            RpcError,
            "bad_request",
            "parameter must be one JSON object",
        ),
        ({"ok": False}, RpcProtocolError, "bad_reply", "the error reply carries no error code"),
    ],
)
def test_a_null_id_error_reply_raises_the_game_error_and_a_reply_without_a_code_is_a_protocol_error(
    fields, error, code, message
):
    def handler(command, count):
        return json.dumps({"v": 1, "id": parse(command)["id"], **fields})

    async def body(rpc, session):
        await rpc.call("snapshot", {})

    with pytest.raises(RpcError) as raised:
        asyncio.run(with_server(handler, body))
    assert (type(raised.value), raised.value.code, raised.value.message) == (error, code, message)
