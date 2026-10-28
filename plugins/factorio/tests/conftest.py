"""Shared tool-test fakes: one RPC recorder, one MCP caller, and raw RPC replies."""

import asyncio
import json

from fastmcp import Client, FastMCP

from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog
from factorio.tools import body, read, talk
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
    read.register(mcp, deps)
    talk.register(mcp, deps)
    body.register(mcp, deps)
    return mcp


def call(mcp, tool_name, **kwargs):
    async def case():
        async with Client(mcp) as client:
            return (await client.call_tool(tool_name, kwargs)).data

    return asyncio.run(case())


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
