"""The eight tools map to one op each, and game errors surface as tool errors."""

import asyncio

import pytest
from fastmcp.exceptions import ToolError

from factorio.events.cache import EventCache, Session
from factorio.outcome_log import OutcomeLog
from factorio.rpc import RpcError
from factorio.tools import read, talk


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


def configure(tmp_path, rpc):
    read.configure(rpc=rpc, session=Session(), cache=EventCache(), log=OutcomeLog(tmp_path / "outcome.jsonl"))
    talk.configure(rpc=rpc, log=OutcomeLog(tmp_path / "outcome.jsonl"))
    return rpc


def test_read_tools_map_to_one_op(tmp_path):
    rpc = configure(tmp_path, FakeRpc())
    asyncio.run(read.factorio_status())
    asyncio.run(read.factorio_snapshot())
    asyncio.run(read.factorio_snapshot(["power"]))
    asyncio.run(read.factorio_find("iron-plate", kind="item", limit=5))
    asyncio.run(read.factorio_inspect(42))
    asyncio.run(read.factorio_recipe("iron-gear-wheel"))
    assert rpc.calls == [
        ("status", {}),
        ("snapshot", {}),
        ("snapshot", {"sections": ["power"]}),
        ("find", {"query": "iron-plate", "kind": "item", "limit": 5}),
        ("inspect", {"unit_number": 42}),
        ("recipe", {"name": "iron-gear-wheel"}),
    ]


def test_find_omits_an_absent_kind(tmp_path):
    rpc = configure(tmp_path, FakeRpc())
    asyncio.run(read.factorio_find("iron-plate"))
    assert rpc.calls == [("find", {"query": "iron-plate", "limit": 20})]


def test_talk_tools_map_to_one_op(tmp_path):
    rpc = configure(tmp_path, FakeRpc())
    asyncio.run(talk.factorio_say("hello there"))
    asyncio.run(talk.factorio_ping({"x": 1.5, "y": 2.5}, "look here"))
    assert rpc.calls == [
        ("say", {"text": "hello there"}),
        ("ping", {"pos": {"x": 1.5, "y": 2.5}, "text": "look here"}),
    ]


def test_a_game_error_becomes_a_tool_error_with_code_and_message(tmp_path):
    configure(tmp_path, FakeRpc(error=RpcError("too_large", "reply is too large")))
    with pytest.raises(ToolError, match="too_large — reply is too large"):
        asyncio.run(talk.factorio_say("hello"))


class FakeBackground:
    def __init__(self):
        self.started = False
        self.closed = False

    async def run(self):
        self.started = True
        await asyncio.sleep(3600)

    async def aclose(self):
        self.closed = True


def test_the_server_runs_the_poller_and_doorbell_for_the_connection_lifetime(tmp_path):
    from fastmcp import Client

    from factorio import server

    rpc = configure(tmp_path, FakeRpc())
    poller, doorbell = FakeBackground(), FakeBackground()
    mcp = server.build_mcp(
        rpc=rpc,
        session=Session(),
        cache=EventCache(),
        log=OutcomeLog(tmp_path / "o.jsonl"),
        poller=poller,
        doorbell=doorbell,
    )

    async def case():
        async with Client(mcp) as client:
            await client.list_tools()
            assert (poller.started, doorbell.started) == (True, True)
        assert doorbell.closed is True

    asyncio.run(case())


def test_the_mod_registers_all_eight_tools(tmp_path):
    from factorio import server

    rpc = configure(tmp_path, FakeRpc())
    mcp = server.build_mcp(
        rpc=rpc, session=Session(), cache=EventCache(), log=OutcomeLog(tmp_path / "o.jsonl")
    )
    names = {tool.name for tool in asyncio.run(mcp.list_tools())}
    assert names == {
        "factorio_status",
        "factorio_events",
        "factorio_snapshot",
        "factorio_find",
        "factorio_inspect",
        "factorio_recipe",
        "factorio_say",
        "factorio_ping",
    }
