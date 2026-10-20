"""Body tools: op mapping, the enqueue shape, game refusals, and the write path."""

import asyncio
import json

import pytest
from fake_rcon import CLOSE, FakeRconServer
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError

from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog
from factorio.rcon.client import RconClient
from factorio.rpc import RpcClient, RpcError
from factorio.tools import body
from factorio.tools.deps import ToolDeps


class FakeRpc:
    def __init__(self, reply=None, error=None):
        self.reply = {"ok": True} if reply is None else reply
        self.error = error
        self.calls = []

    async def call(self, op, args):
        self.calls.append((op, args))
        if self.error is not None:
            raise self.error
        return self.reply


def configured(tmp_path, rpc):
    mcp = FastMCP(name="test")
    deps = ToolDeps(rpc=rpc, session=Session(), log=OutcomeLog(tmp_path / "outcome.jsonl"))
    body.register(mcp, deps)
    return mcp


def call(mcp, tool_name, **kwargs):
    async def case():
        async with Client(mcp) as client:
            return (await client.call_tool(tool_name, kwargs)).data

    return asyncio.run(case())


@pytest.mark.parametrize(
    ("tool", "kwargs", "op", "args"),
    [
        ("factorio_jobs", {}, "jobs", {}),
        (
            "factorio_jobs_enqueue",
            {"jobs": [{"kind": "walk_to", "args": {"pos": {"x": 0.0, "y": 0.0}, "radius": 2}}]},
            "jobs_enqueue",
            {"jobs": [{"kind": "walk_to", "args": {"pos": {"x": 0.0, "y": 0.0}, "radius": 2}}]},
        ),
        (
            "factorio_jobs_enqueue",
            {"jobs": [{"kind": "wait", "args": {"ticks": 30}, "timeout_ticks": 60}]},
            "jobs_enqueue",
            {"jobs": [{"kind": "wait", "args": {"ticks": 30}, "timeout_ticks": 60}]},
        ),
        ("factorio_jobs_cancel", {"id": "3"}, "jobs_cancel", {"id": 3}),
        ("factorio_jobs_cancel", {"id": "all"}, "jobs_cancel", {"all": True}),
        ("factorio_idle", {"mode": "follow"}, "idle_set", {"mode": "follow"}),
        (
            "factorio_idle",
            {"mode": "stay", "pos": {"x": 1.0, "y": 2.0}},
            "idle_set",
            {"mode": "stay", "pos": {"x": 1.0, "y": 2.0}},
        ),
        ("factorio_stop", {}, "stop", {}),
    ],
)
def test_each_tool_maps_to_one_op(tmp_path, tool, kwargs, op, args):
    rpc = FakeRpc()
    assert call(configured(tmp_path, rpc), tool, **kwargs) == {"ok": True}
    assert rpc.calls == [(op, args)]


@pytest.mark.parametrize(
    "jobs",
    [[], [{"kind": "wait", "args": {"ticks": 1}}] * 9],
)
def test_jobs_enqueue_requires_one_to_eight_jobs_before_any_rpc(tmp_path, jobs):
    rpc = FakeRpc()
    with pytest.raises(ToolError, match="jobs must hold 1 to 8 entries"):
        call(configured(tmp_path, rpc), "factorio_jobs_enqueue", jobs=jobs)
    assert rpc.calls == []


@pytest.mark.parametrize(
    "job",
    [
        {"kind": "wait"},
        {"kind": "wait", "args": "nope"},
        {"args": {"ticks": 1}},
        {"kind": "wait", "args": {"ticks": 1}, "timeout_ticks": "soon"},
    ],
)
def test_jobs_enqueue_rejects_a_malformed_job_before_any_rpc(tmp_path, job):
    rpc = FakeRpc()
    with pytest.raises(ToolError, match="validation error"):
        call(configured(tmp_path, rpc), "factorio_jobs_enqueue", jobs=[job])
    assert rpc.calls == []


@pytest.mark.parametrize(
    ("code", "message"),
    [
        ("unsupported", "job kind fly set no timeout_ticks at its start"),
        ("not_permitted", "the target is not an allowed mine target that yields coal"),
        ("bad_request", "jobs[0].kind: one of deliver, follow, mine, wait, walk_to expected"),
    ],
)
def test_a_game_refusal_becomes_a_tool_error_with_the_game_message(tmp_path, code, message):
    mcp = configured(tmp_path, FakeRpc(error=RpcError(code, message)))
    with pytest.raises(ToolError) as raised:
        call(mcp, "factorio_jobs_enqueue", jobs=[{"kind": "walk_to", "args": {"radius": 2}}])
    assert str(raised.value) == f"factorio_jobs_enqueue: {code} — {message}"


def parse(command: str) -> dict:
    return json.loads(command.removeprefix("/coop-rpc "))


def reply(
    request: dict, *, ok: bool = True, r: object = None, e: str | None = None, m: str | None = None
) -> str:
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


def call_over_rcon(tmp_path, handler, **kwargs):
    async def case():
        server = await FakeRconServer(handler=handler).start()
        try:
            session = Session()
            session.map_id = "map-a"
            rcon = RconClient("127.0.0.1", server.port, "secret", timeout=1.0)
            rpc = RpcClient(rcon, session, sleep=no_sleep)
            mcp = FastMCP(name="test")
            body.register(mcp, ToolDeps(rpc=rpc, session=session, log=OutcomeLog(tmp_path / "o.jsonl")))
            async with Client(mcp) as client:
                return await client.call_tool("factorio_jobs_enqueue", kwargs)
        finally:
            await server.close()

    return asyncio.run(case())


def test_jobs_enqueue_replays_the_same_id_after_an_unknown_outcome(tmp_path):
    requests = []

    def handler(command, count):
        request = parse(command)
        requests.append(request)
        if request["op"] == "status":
            return reply(request, r={"map_id": "map-a", "seq": 0})
        if len([item for item in requests if item["op"] == "jobs_enqueue"]) == 1:
            return CLOSE
        return reply(request, r={"ids": [1]})

    jobs = [{"kind": "walk_to", "args": {"pos": {"x": 8.0, "y": 0.0}, "radius": 2}}]
    result = call_over_rcon(tmp_path, handler, jobs=jobs)
    enqueues = [request for request in requests if request["op"] == "jobs_enqueue"]
    assert result.data == {"ids": [1]}
    assert [request["id"] for request in enqueues] == [enqueues[0]["id"]] * 2
    assert [request["args"] for request in enqueues] == [{"jobs": jobs}] * 2


def test_jobs_enqueue_stops_on_an_id_conflict_replay(tmp_path):
    requests = []

    def handler(command, count):
        request = parse(command)
        requests.append(request)
        if request["op"] == "status":
            return reply(request, r={"map_id": "map-a", "seq": 0})
        if len([item for item in requests if item["op"] == "jobs_enqueue"]) == 1:
            return CLOSE
        return reply(request, ok=False, e="id_conflict", m="id already used with different arguments")

    with pytest.raises(ToolError) as raised:
        call_over_rcon(
            tmp_path,
            handler,
            jobs=[{"kind": "wait", "args": {"ticks": 30}}],
        )
    assert str(raised.value) == (
        "factorio_jobs_enqueue: id_conflict — id already used with different arguments"
    )
    enqueues = [request for request in requests if request["op"] == "jobs_enqueue"]
    assert [request["id"] for request in enqueues] == [enqueues[0]["id"]] * 2
