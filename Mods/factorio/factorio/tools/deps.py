"""One dependency object for the tools, and the game-error to tool-error mapping."""

from dataclasses import dataclass
from typing import Any

from fastmcp.exceptions import ToolError

from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog
from factorio.rpc import RpcClient, RpcError

REASONS = {
    "not_console": "no player console is open in the game.",
    "bad_request": "the game mod rejected the request shape.",
    "unknown_op": "the game mod does not know this operation.",
    "stale_session": "the game map changed during the call.",
    "id_conflict": "the game mod saw the same request id twice.",
    "too_large": "the reply is too large for RCON.",
    "too_long": "the text is longer than the game mod accepts.",
    "op_error": "the game mod reported an operation error.",
    "rate_limited": "the game mod is rate limiting calls.",
    "history_gap": "the requested event range is no longer in the game mod's history.",
    "unknown_outcome": "the game mod did not answer; the call may or may not have run.",
    "rcon_auth": "RCON rejected the password from the game's config.ini.",
}


@dataclass(frozen=True)
class ToolDeps:
    rpc: RpcClient
    session: Session
    log: OutcomeLog

    async def execute(self, tool: str, op: str, args: dict[str, Any]) -> Any:
        """Run one op and translate a game-mod refusal into a tool error."""
        try:
            result = await self.rpc.call(op, args)
        except RpcError as err:
            self.log.tool(tool=tool, args=args, ok=False, error=err.code)
            reason = err.message or REASONS.get(err.code, "the game mod refused the call without a reason.")
            raise ToolError(f"{tool}: {err.code} — {reason}") from err
        self.log.tool(tool=tool, args=args, ok=True)
        return result
