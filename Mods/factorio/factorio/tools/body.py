"""Body tools: the job queue, the idle mode, and the stop."""

from typing import Any, Literal, NotRequired, TypedDict

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from factorio.tools.deps import ToolDeps

MAX_JOBS_PER_CALL = 8


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
- `target_gone`: a target no longer exists.
- `not_permitted`: the named `mine` entity is not an allowed target that yields `name`.
- `unreachable`: the named `mine` entity is more than 64 tiles from the body.
- `unsupported`: the named `mine` entity needs a fluid to mine, or a job kind set no `timeout_ticks` at its start.
- `target_full`: the body has no room for `name`.
- `timeout`: `timeout_ticks` elapsed since the job start.
- `stopped`: the stop latch is on, or no host is connected.
- `body_dead`: no live body.
- `cancelled`: a cancel, or an earlier job of the queue failed."""


def register(mcp: FastMCP, deps: ToolDeps) -> None:
    @mcp.tool
    async def factorio_jobs() -> Any:
        """Read every job record the game mod holds, oldest first."""
        return await deps.execute("factorio_jobs", "jobs", {})

    @mcp.tool(description=JOBS_ENQUEUE_DESCRIPTION)
    async def factorio_jobs_enqueue(jobs: list[Job]) -> Any:
        return await deps.execute("factorio_jobs_enqueue", "jobs_enqueue", {"jobs": _specs(jobs)})

    @mcp.tool
    async def factorio_jobs_cancel(id: str) -> Any:
        """Cancel one queued or running job by `id`, or every job with `all`. A cancel fires no event."""
        args: dict[str, Any] = {"all": True} if id == "all" else {"id": _job_id(id)}
        return await deps.execute("factorio_jobs_cancel", "jobs_cancel", args)

    @mcp.tool
    async def factorio_idle(mode: Literal["follow", "stay"], pos: dict | None = None) -> Any:
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
    if not 1 <= len(jobs) <= MAX_JOBS_PER_CALL:
        raise ToolError(f"factorio_jobs_enqueue: jobs must hold 1 to {MAX_JOBS_PER_CALL} entries.")
    specs: list[dict[str, Any]] = []
    for job in jobs:
        spec: dict[str, Any] = {"kind": job["kind"], "args": job["args"]}
        if job.get("timeout_ticks") is not None:
            spec["timeout_ticks"] = job["timeout_ticks"]
        specs.append(spec)
    return specs


def _job_id(text: str) -> int | str:
    """The game op takes a numeric id; a non-numeric text goes to the game as it is."""
    return int(text) if text.isdecimal() else text
