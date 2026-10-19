"""Talk tools: one chat line and one map ping."""

from typing import Any

from factorio.rpc import RpcClient, execute

_rpc: RpcClient | None = None
_log = None


def configure(*, rpc: RpcClient, log) -> None:
    global _rpc, _log
    _rpc, _log = rpc, log


async def factorio_say(text: str) -> Any:
    """Say one line in game chat as the host character."""
    return await execute(_rpc, _log, "factorio_say", "say", {"text": text})


async def factorio_ping(pos: dict[str, float], text: str) -> Any:
    """Ping a map position. `text` is the label shown at the position."""
    return await execute(_rpc, _log, "factorio_ping", "ping", {"pos": pos, "text": text})


TOOLS = (factorio_say, factorio_ping)
