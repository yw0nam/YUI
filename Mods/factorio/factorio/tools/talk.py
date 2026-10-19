"""Talk tools: one chat line and one map ping."""

from typing import Any

from fastmcp import FastMCP

from factorio.tools.deps import ToolDeps


def register(mcp: FastMCP, deps: ToolDeps) -> None:
    @mcp.tool
    async def factorio_say(text: str) -> Any:
        """Say one line in game chat as the host character."""
        return await deps.execute("factorio_say", "say", {"text": text})

    @mcp.tool
    async def factorio_ping(pos: dict[str, float], text: str) -> Any:
        """Ping a map position. `text` is the label shown at the position."""
        return await deps.execute("factorio_ping", "ping", {"pos": pos, "text": text})
