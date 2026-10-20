"""Body tools: the job queue, the idle mode, and the stop."""

from typing import Annotated, Any, Literal, NotRequired, TypedDict

from fastmcp import FastMCP
from pydantic import Field

from factorio.tools.deps import ToolDeps


class Job(TypedDict):
    """One job spec: the game mod validates the kind and the args."""

    kind: str
    args: dict[str, Any]
    timeout_ticks: NotRequired[int | None]


JOBS_ENQUEUE_DESCRIPTION = """Queue 1 to 8 jobs in order. The reply holds the assigned ids in the same order. A refused call queues no job. The refusal is a `bad_request` tool error with the game message.

A job is `{kind, args, timeout_ticks?}`. `timeout_ticks` is a positive number and counts from the job start.

`walk_to`: `pos {x, y}` or `entity` (a unit number from `factorio_find` or `factorio_inspect`), and `radius` > 0. The job ends when the body is within `radius` of the position or of the entity's position at the job start.
`wait`: `ticks` > 0. The job ends when `ticks` have elapsed.
`follow`: `ticks` > 0. The job walks toward the host like the idle mode. The job ends when `ticks` have elapsed.
`mine`: `name` (an item), `count` (an integer 1 to 1000), and optional `entity` (a unit number). The job ends when the body holds `count` more `name` than at the job start.
`deliver`: `item` and `count` (an integer 1 to 1000). The job ends when the body walks to within 3 tiles of the host and spills `count` of `item` on the host's far side. The spilled items are `item-on-ground` flagged `to_be_looted`. Then the body steps back to 6 tiles from the host, or the step-back's 180 ticks end, or its walk fails.

A failed job reports one of these reason codes:
- `no_path`: the 6th path request failed.
- `stuck`: 600 ticks without movement on a route.
- `target_gone`: the `walk_to` entity no longer exists; no `mine` target is within 64 tiles, the named `entity` no longer exists, or a second `mine` target disappeared.
- `no_item`: `deliver`: the body holds fewer than `count` of `item`, checked at the start and again before the spill. The detail is `{item, count, held}`.
- `not_permitted`: the named `mine` entity is not an allowed target that yields `name`.
- `unreachable`: the named `mine` entity is more than 64 tiles from the body.
- `unsupported`: the named `mine` entity needs a fluid to mine, or a job kind set no `timeout_ticks` at its start.
- `target_full`: `mine`: the body has no room for `name`. `deliver`: the spill fell short. The detail is `{removed, spilled}`.
- `timeout`: `timeout_ticks` elapsed since the job start.
- `stopped`: the stop latch is on or no host is connected; also on jobs cancelled before any started.
- `body_dead`: there is no live body; also on jobs cancelled before any started.
- `cancelled`: a cancel, or an earlier job of the queue failed."""


def register(mcp: FastMCP, deps: ToolDeps) -> None:
    @mcp.tool
    async def factorio_jobs() -> Any:
        """Read every job record the game mod holds, oldest first."""
        return await deps.execute("factorio_jobs", "jobs", {})

    @mcp.tool(description=JOBS_ENQUEUE_DESCRIPTION)
    async def factorio_jobs_enqueue(
        jobs: Annotated[list[Job], Field(min_length=1, max_length=8)],
    ) -> Any:
        return await deps.execute("factorio_jobs_enqueue", "jobs_enqueue", {"jobs": _specs(jobs)})

    @mcp.tool
    async def factorio_jobs_cancel(id: int | Literal["all"]) -> Any:
        """Cancel one queued or running job by `id`, or every job with `all`. A cancel fires no event."""
        args: dict[str, Any] = {"all": True} if id == "all" else {"id": id}
        return await deps.execute("factorio_jobs_cancel", "jobs_cancel", args)

    @mcp.tool
    async def factorio_idle(mode: Literal["follow", "stay"], pos: dict[str, float] | None = None) -> Any:
        """Set the body's idle mode.

        `follow` keeps the body near the host. `stay` walks to `pos` once and then
        stands. `stay` without `pos` stands at the body's position. The call lifts
        the stop latch.
        """
        args: dict[str, Any] = {"mode": mode}
        if pos is not None:
            args["pos"] = pos
        return await deps.execute("factorio_idle", "idle_set", args)

    @mcp.tool
    async def factorio_stop() -> Any:
        """Stop the body's walking, mining, and crafting.

        The first stop latches the body stopped. A job enqueue or `factorio_idle`
        lifts the latch.
        """
        return await deps.execute("factorio_stop", "stop", {})


def _specs(jobs: list[Job]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for job in jobs:
        spec: dict[str, Any] = {"kind": job["kind"], "args": job["args"]}
        if job.get("timeout_ticks") is not None:
            spec["timeout_ticks"] = job["timeout_ticks"]
        specs.append(spec)
    return specs
