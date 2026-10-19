"""Read tools: status, cached events, snapshot, find, inspect, and recipe."""

from typing import Any

from fastmcp.exceptions import ToolError

from factorio.events.cache import PAGE_LIMIT, EventCache, Session
from factorio.rpc import RpcClient, execute

_rpc: RpcClient | None = None
_session: Session | None = None
_cache: EventCache | None = None
_log = None


def configure(*, rpc: RpcClient, session: Session, cache: EventCache, log) -> None:
    global _rpc, _session, _cache, _log
    _rpc, _session, _cache, _log = rpc, session, cache, log


async def factorio_status() -> Any:
    """Report the game mod version, map id, newest event sequence, tick, and host state."""
    return await execute(_rpc, _log, "factorio_status", "status", {})


async def factorio_events(since_seq: int | None = None, limit: int = 200) -> dict[str, Any]:
    """Read cached game events after a sequence number.

    `since_seq` is exclusive. The default is the unread cursor. A value above the
    cursor is clamped to it. A value below it re-reads older cached events. Returns
    at most 200 events, `next_seq`, and whether more remain.
    """
    if limit < 1:
        raise ToolError("factorio_events: limit must be at least 1.")
    limit = min(limit, PAGE_LIMIT)
    result = _session.read(_cache, since_seq, limit)
    args = {"since_seq": since_seq, "limit": limit}
    _log.tool(
        tool="factorio_events",
        args=args,
        ok=True,
    )
    return result


async def factorio_snapshot(sections: list[str] | None = None) -> Any:
    """Read a state snapshot of the factory.

    `sections` names the parts to include. Omit it for every section.
    """
    args: dict[str, Any] = {}
    if sections is not None:
        args["sections"] = sections
    return await execute(_rpc, _log, "factorio_snapshot", "snapshot", args)


async def factorio_find(query: str, kind: str | None = None, limit: int = 20) -> Any:
    """Find entities by name.

    `kind` limits the result to one entity type. `limit` caps the number of results.
    """
    args: dict[str, Any] = {"query": query, "limit": limit}
    if kind is not None:
        args["kind"] = kind
    return await execute(_rpc, _log, "factorio_find", "find", args)


async def factorio_inspect(unit_number: int) -> Any:
    """Read one entity by its unit number."""
    return await execute(_rpc, _log, "factorio_inspect", "inspect", {"unit_number": unit_number})


async def factorio_recipe(name: str) -> Any:
    """Read one recipe by name."""
    return await execute(_rpc, _log, "factorio_recipe", "recipe", {"name": name})


TOOLS = (
    factorio_status,
    factorio_events,
    factorio_snapshot,
    factorio_find,
    factorio_inspect,
    factorio_recipe,
)
