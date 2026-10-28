"""Every tool maps to one op, and game errors surface as tool errors."""

import asyncio

import pytest
from conftest import FakeRpc, call, configured
from fastmcp import Client
from fastmcp.exceptions import ToolError

from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog
from factorio.rpc import RpcError


@pytest.mark.parametrize(
    ("tool", "kwargs", "op", "args"),
    [
        ("factorio_status", {}, "status", {}),
        ("factorio_snapshot", {}, "snapshot", {}),
        ("factorio_snapshot", {"sections": ["power"]}, "snapshot", {"sections": ["power"]}),
        ("factorio_find", {}, "find", {"limit": 50}),
        (
            "factorio_find",
            {"name": "iron-plate", "type": "item", "limit": 5},
            "find",
            {"name": "iron-plate", "type": "item", "limit": 5},
        ),
        (
            "factorio_find",
            {
                "area": {"x1": 0.0, "y1": 0.0, "x2": 10.0, "y2": 10.0},
                "around": "player",
                "limit": 7,
            },
            "find",
            {
                "area": {"x1": 0.0, "y1": 0.0, "x2": 10.0, "y2": 10.0},
                "around": "player",
                "limit": 7,
            },
        ),
        ("factorio_inspect", {"unit_number": 42}, "inspect", {"unit_number": 42}),
        ("factorio_recipe", {"name": "iron-gear-wheel"}, "recipe", {"name": "iron-gear-wheel"}),
        ("factorio_say", {"text": "hello there"}, "say", {"text": "hello there"}),
        (
            "factorio_ping",
            {"pos": {"x": 1.5, "y": 2.5}, "text": "look here"},
            "ping",
            {"pos": {"x": 1.5, "y": 2.5}, "text": "look here"},
        ),
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
        ("factorio_jobs_cancel", {"id": 3}, "jobs_cancel", {"id": 3}),
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


def test_a_game_error_becomes_a_tool_error_with_code_and_message(tmp_path):
    mcp = configured(tmp_path, FakeRpc(error=RpcError("too_large", "reply is too large")))
    with pytest.raises(ToolError, match="too_large — reply is too large"):
        call(mcp, "factorio_say", text="hello")


def test_an_error_without_a_message_uses_the_reason(tmp_path):
    mcp = configured(tmp_path, FakeRpc(error=RpcError("too_long")))
    with pytest.raises(ToolError, match="too_long — the text is longer than the game mod accepts."):
        call(mcp, "factorio_say", text="hello")


class FakeBackground:
    def __init__(self):
        self.started = False
        self.closed = False

    async def run(self):
        self.started = True
        await asyncio.sleep(3600)

    async def aclose(self):
        self.closed = True


def server_with_fakes(tmp_path):
    from factorio import server

    poller, doorbell = FakeBackground(), FakeBackground()
    mcp = server.build_mcp(
        rpc=FakeRpc(),
        session=Session(),
        log=OutcomeLog(tmp_path / "o.jsonl"),
        poller=poller,
        doorbell=doorbell,
    )
    return mcp, poller, doorbell


def test_the_server_runs_the_poller_and_doorbell_for_the_connection_lifetime(tmp_path):
    mcp, poller, doorbell = server_with_fakes(tmp_path)

    async def case():
        async with Client(mcp) as client:
            await client.list_tools()
            assert (poller.started, doorbell.started) == (True, True)
        assert doorbell.closed is True

    asyncio.run(case())


def test_the_mod_registers_all_thirteen_tools(tmp_path):
    mcp, _poller, _doorbell = server_with_fakes(tmp_path)
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
        "factorio_jobs",
        "factorio_jobs_enqueue",
        "factorio_jobs_cancel",
        "factorio_idle",
        "factorio_stop",
    }
