"""`/coop-rpc` request shape, reply parsing, and the write replay rules."""

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastmcp.exceptions import ToolError
from loguru import logger

from factorio.rcon.client import RconError, RconTimeout, RconUnavailable

MAX_UNKNOWN_REPLAYS = 3
MAX_ID_CONFLICTS = 3

REASONS = {
    "not_console": "no player console is open in the game.",
    "bad_request": "the game mod rejected the request shape.",
    "unknown_op": "the game mod does not know this operation.",
    "stale_session": "the game map changed during the call.",
    "id_conflict": "the game mod saw the same request id twice.",
    "too_large": "the reply is too large for RCON.",
    "op_error": "the game mod reported an operation error.",
    "rate_limited": "the game mod is rate limiting calls.",
    "history_gap": "the requested event range is no longer in the game mod's history.",
    "unknown_outcome": "the game mod did not answer; the call may or may not have run.",
    "timeout": "RCON did not answer in time.",
    "rcon_unavailable": "the game is not reachable over RCON.",
    "rcon_auth": "RCON rejected the password from the game's config.ini.",
}


class RpcError(RuntimeError):
    """The game mod answered with `ok: false`."""

    def __init__(self, code: str, message: str = "", result: Any = None):
        super().__init__(message or code)
        self.code = code
        self.message = message
        self.result = result


class RpcProtocolError(RpcError):
    """The RCON reply is not a `/coop-rpc` reply."""


class RpcUnavailable(RpcError):
    """No reply arrived, so the outcome of the call is unknown."""


class RpcClient:
    """Send ops to the game mod and keep the current map id."""

    def __init__(
        self,
        rcon,
        on_session_reset: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ):
        self._rcon = rcon
        self.on_session_reset = on_session_reset
        self.map_id: str | None = None

    async def status(self) -> dict[str, Any]:
        """Call `status`, which carries no map id, and adopt the map it reports."""
        return await self.call("status", {})

    async def call(self, op: str, args: dict[str, Any] | None = None) -> Any:
        request_id = str(uuid.uuid4())
        conflicts = 0
        unknown = 0
        while True:
            request = self._build(op, args or {}, request_id)
            try:
                raw = await self._rcon.command(_command(request))
            except (RconTimeout, RconUnavailable) as err:
                unknown += 1
                if unknown >= MAX_UNKNOWN_REPLAYS:
                    raise RpcUnavailable("unknown_outcome", err.message) from err
                logger.bind(op=op, request_id=request_id, attempt=unknown).warning("rpc_replay")
                continue
            except RconError as err:
                raise RpcUnavailable(err.code, err.message) from err

            reply = _parse(raw, request_id)
            if reply.get("ok") is True:
                result = reply.get("r")
                if op == "status" and isinstance(result, dict):
                    self.map_id = result.get("map_id")
                return result

            code = str(reply.get("e", "unknown_op"))
            message = str(reply.get("m", "") or "")
            result = reply.get("r")
            if code == "id_conflict":
                conflicts += 1
                logger.bind(op=op, request_id=request_id).warning("rpc_id_conflict")
                if conflicts >= MAX_ID_CONFLICTS:
                    raise RpcError(code, message, result)
                request_id = str(uuid.uuid4())
                continue
            if code == "stale_session" and op != "status" and self.on_session_reset is not None:
                status = await self.status()
                self.map_id = status.get("map_id")
                await self.on_session_reset(status)
                continue
            raise RpcError(code, message, result)

    def retry_delay(self) -> float:
        """Next reconnect delay, doubling up to the 30 s cap."""
        return self._rcon.backoff.next_delay()

    def _build(self, op: str, args: dict[str, Any], request_id: str) -> dict[str, Any]:
        request = {"v": 1, "id": request_id, "op": op, "args": args}
        if op != "status":
            request["map_id"] = self.map_id
        return request


async def execute(rpc: RpcClient, log, tool: str, op: str, args: dict[str, Any]) -> Any:
    """Run one tool call and translate a game-mod refusal into a tool error."""
    try:
        result = await rpc.call(op, args)
    except RpcError as err:
        log.tool(tool=tool, args=args, ok=False, error=err.code)
        reason = err.message or REASONS.get(err.code, "the game mod refused the call without a reason.")
        raise ToolError(f"{tool}: {err.code} — {reason}") from err
    log.tool(tool=tool, args=args, ok=True)
    return result


def _command(request: dict[str, Any]) -> str:
    payload = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
    return f"/coop-rpc {payload}"


def _parse(raw: str, request_id: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        raise RpcProtocolError("bad_reply", "RCON returned no reply")
    try:
        reply = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise RpcProtocolError("bad_reply", f"reply is not JSON: {text[:120]}") from None
        try:
            reply = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            raise RpcProtocolError("bad_reply", f"reply is not JSON: {text[:120]}") from None
    if not isinstance(reply, dict):
        raise RpcProtocolError("bad_reply", "the reply is not a JSON object")
    if reply.get("v") != 1:
        raise RpcProtocolError("bad_reply", "the reply has no version 1")
    if reply.get("id") != request_id:
        raise RpcProtocolError("id_mismatch", "the reply id does not match the request id")
    return reply
