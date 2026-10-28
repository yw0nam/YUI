"""Body tools: the enqueue bounds, the published schema, and the Job shape."""

import asyncio

import pytest
from conftest import FakeRpc, call, configured
from fastmcp import Client
from fastmcp.exceptions import ToolError


@pytest.mark.parametrize(
    "jobs",
    [[], [{"kind": "wait", "args": {"ticks": 1}}] * 9],
)
def test_jobs_enqueue_requires_one_to_eight_jobs_before_any_rpc(tmp_path, jobs):
    rpc = FakeRpc()
    with pytest.raises(ToolError):
        call(configured(tmp_path, rpc), "factorio_jobs_enqueue", jobs=jobs)
    assert rpc.calls == []


def test_jobs_enqueue_schema_publishes_the_bounds(tmp_path):
    async def case():
        async with Client(configured(tmp_path, FakeRpc())) as client:
            return {tool.name: tool for tool in await client.list_tools()}

    jobs = asyncio.run(case())["factorio_jobs_enqueue"].input_schema["properties"]["jobs"]
    assert (jobs["minItems"], jobs["maxItems"]) == (1, 8)


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


def test_jobs_cancel_rejects_a_non_numeric_string_before_any_rpc(tmp_path):
    rpc = FakeRpc()
    with pytest.raises(ToolError):
        call(configured(tmp_path, rpc), "factorio_jobs_cancel", id="abc")
    assert rpc.calls == []
