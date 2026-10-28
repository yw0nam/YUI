"""Read tools: status, cached events, snapshot, find, inspect, and recipe."""

from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from factorio.events.cache import PAGE_LIMIT
from factorio.tools.deps import ToolDeps

EVENTS_DESCRIPTION = f"""Read cached game events after a sequence number.

`since_seq` is exclusive. The default is the unread cursor. A value above the
cursor is clamped to it. A value below it re-reads older cached events. Returns
at most {PAGE_LIMIT} events, `next_seq`, and whether more remain."""


def register(mcp: FastMCP, deps: ToolDeps) -> None:
    @mcp.tool
    async def factorio_status() -> Any:
        """Report the game mod version, map id, newest event sequence, tick, and host state."""
        return await deps.execute("factorio_status", "status", {})

    @mcp.tool(description=EVENTS_DESCRIPTION)
    async def factorio_events(since_seq: int | None = None, limit: int = PAGE_LIMIT) -> dict[str, Any]:
        if limit < 1:
            raise ToolError("factorio_events: limit must be at least 1.")
        limit = min(limit, PAGE_LIMIT)
        result = deps.session.read(since_seq, limit)
        deps.log.tool(
            tool="factorio_events",
            args={"since_seq": since_seq, "limit": limit},
            ok=True,
        )
        return result

    @mcp.tool
    async def factorio_snapshot(sections: list[str] | None = None) -> Any:
        """Read a state snapshot of the factory.

        `sections` names the parts to include. Omit it for every section.
        """
        args: dict[str, Any] = {}
        if sections is not None:
            args["sections"] = sections
        return await deps.execute("factorio_snapshot", "snapshot", args)

    @mcp.tool
    async def factorio_find(
        area: dict | None = None,
        around: str | None = None,
        name: str | None = None,
        type: str | None = None,
        limit: int = 50,
    ) -> Any:
        """Find entities by name, type, area, or near the host player.

        `area` is a map rectangle. `around` is `player`. `limit` caps the results.
        """
        args: dict[str, Any] = {"limit": limit}
        if area is not None:
            args["area"] = area
        if around is not None:
            args["around"] = around
        if name is not None:
            args["name"] = name
        if type is not None:
            args["type"] = type
        return await deps.execute("factorio_find", "find", args)

    @mcp.tool
    async def factorio_inspect(unit_number: int) -> Any:
        """Read one entity by its unit number."""
        return await deps.execute("factorio_inspect", "inspect", {"unit_number": unit_number})

    @mcp.tool
    async def factorio_recipe(name: str) -> Any:
        """Read one recipe by name."""
        return await deps.execute("factorio_recipe", "recipe", {"name": name})
