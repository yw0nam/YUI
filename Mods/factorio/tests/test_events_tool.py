"""factorio_events: the unread cursor, clamping, re-reads, paging, and forward-only reads."""

import asyncio

import pytest
from fastmcp import Client, FastMCP

from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog
from factorio.tools import read
from factorio.tools.deps import ToolDeps


def event(seq: int) -> dict:
    return {"seq": seq, "tick": seq * 60, "kind": "tick", "data": {}}


def configured(tmp_path, count: int = 250):
    session = Session()
    session.map_id = "map-a"
    session.on_map_change({"map_id": "map-a", "seq": 0})
    session.on_page(
        {"map_id": "map-a", "head_seq": count, "events": [event(seq) for seq in range(1, count + 1)]}
    )
    mcp = FastMCP(name="test")
    read.register(mcp, ToolDeps(rpc=None, session=session, log=OutcomeLog(tmp_path / "outcome.jsonl")))
    return mcp, session


def call(mcp, **kwargs):
    async def case():
        async with Client(mcp) as client:
            return (await client.call_tool("factorio_events", kwargs)).data

    return asyncio.run(case())


@pytest.mark.parametrize(
    ("count", "cursor", "kwargs", "expected_seqs", "expected_next", "expected_more", "expected_cursor"),
    [
        (5, 3, {}, [4, 5], 5, False, 5),
        (5, 3, {"since_seq": 999}, [4, 5], 5, False, 5),
        (250, 250, {"since_seq": 100}, list(range(101, 251)), 250, False, 250),
        (250, 0, {"limit": 500}, list(range(1, 201)), 200, True, 200),
    ],
)
def test_the_since_and_limit_clamps(
    tmp_path, count, cursor, kwargs, expected_seqs, expected_next, expected_more, expected_cursor
):
    mcp, session = configured(tmp_path, count=count)
    session.backend_cursor = cursor
    result = call(mcp, **kwargs)
    assert [e["seq"] for e in result["events"]] == expected_seqs
    assert (result["next_seq"], result["more"]) == (expected_next, expected_more)
    assert session.backend_cursor == expected_cursor


def test_a_page_of_200_reports_more_and_moves_the_cursor(tmp_path):
    mcp, session = configured(tmp_path)
    first = call(mcp)
    assert len(first["events"]) == 200
    assert (first["next_seq"], first["more"]) == (200, True)
    assert session.backend_cursor == 200
    second = call(mcp)
    assert len(second["events"]) == 50
    assert (second["next_seq"], second["more"]) == (250, False)
    assert session.backend_cursor == 250
