"""`/coop-rpc` request shape, reply parsing, and unknown-outcome reconciliation."""

import asyncio
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from loguru import logger

from factorio.rcon.client import RconError, RconTimeout, RconUnavailable

UNKNOWN_OUTCOME_S = 60.0
MAX_ID_CONFLICTS = 3


class RpcError(RuntimeError):
    """The game mod answered with `ok: false`."""

    def __init__(self, code: str, message: str = "", result: Any = None):
        super().__init__(message or code)
        self.code = code
        self.message = message
        self.result = result


class RpcProtocolError(RpcError):
    """The RCON reply is not one `/coop-rpc` reply."""


class RpcUnavailable(RpcError):
    """No reply arrived, so the outcome of the call is unknown."""


class RpcClient:
    """Send ops to the game mod and keep the current map id."""

    def __init__(
        self,
        rcon,
        on_session_reset: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        *,
        unknown_budget_s: float = UNKNOWN_OUTCOME_S,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self._rcon = rcon
        self._on_session_reset = on_session_reset
        self._unknown_budget_s = unknown_budget_s
        self._clock = clock
        self._sleep = sleep
        self.map_id: str | None = None

    async def status(self, deadline: float | None = None) -> dict[str, Any]:
        """Call `status`, which carries no map id, and adopt the map it reports."""
        result = await self._call(
            "status",
            {},
            self._clock() + self._unknown_budget_s if deadline is None else deadline,
        )
        if isinstance(result, dict):
            self.map_id = result.get("map_id")
        return result

    async def call(self, op: str, args: dict[str, Any] | None = None) -> Any:
        return await self._call(op, args or {}, self._clock() + self._unknown_budget_s)

    async def _call(self, op: str, args: dict[str, Any], deadline: float) -> Any:
        request_id = str(uuid.uuid4())
        conflicts = 0
        request = self._build(op, args, request_id)
        while True:
            try:
                raw = await self._rcon.command(_command(request))
            except (RconTimeout, RconUnavailable) as err:
                await self._reconcile(request, err, deadline)
                continue
            except RconError as err:
                raise RpcUnavailable(err.code, err.message) from err

            reply = _parse(raw, request_id)
            if reply.get("ok") is True:
                return reply.get("r")

            code = str(reply.get("e", "unknown_op"))
            message = str(reply.get("m", "") or "")
            result = reply.get("r")
            if code == "id_conflict":
                conflicts += 1
                logger.bind(op=op, request_id=request_id).warning("rpc_id_conflict")
                if conflicts >= MAX_ID_CONFLICTS:
                    raise RpcError(code, message, result)
                request_id = str(uuid.uuid4())
                request = self._build(op, args, request_id)
                continue
            if code == "stale_session" and op != "status":
                status = await self.status(deadline)
                if self._on_session_reset is not None:
                    await self._on_session_reset(status)
                raise RpcError(code, message, result)
            raise RpcError(code, message, result)

    def retry_delay(self) -> float:
        """Next reconnect delay, doubling up to the 30 s cap."""
        return self._rcon.backoff.next_delay()

    async def _reconcile(self, request: dict[str, Any], err: RconError, deadline: float) -> None:
        """Wait out the reconnect backoff, then confirm the map before a replay."""
        logger.bind(op=request["op"], request_id=request["id"]).warning("rpc_unknown_outcome")
        if self._clock() >= deadline:
            raise RpcUnavailable("unknown_outcome", err.message) from err
        delay = min(self.retry_delay(), max(deadline - self._clock(), 0.0))
        await self._sleep(delay)
        if self._clock() >= deadline:
            raise RpcUnavailable("unknown_outcome", err.message) from err
        if "map_id" in request:
            status = await self.status(deadline)
            if status.get("map_id") != request["map_id"]:
                if self._on_session_reset is not None:
                    await self._on_session_reset(status)
                raise RpcUnavailable(
                    "unknown_outcome", "the map changed before the reply was confirmed"
                ) from err
        logger.bind(op=request["op"], request_id=request["id"]).warning("rpc_replay")

    def _build(self, op: str, args: dict[str, Any], request_id: str) -> dict[str, Any]:
        request = {"v": 1, "id": request_id, "op": op, "args": args}
        if op != "status":
            request["map_id"] = self.map_id
        return request


def _command(request: dict[str, Any]) -> str:
    payload = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
    return f"/coop-rpc {payload}"


def _parse(raw: str, request_id: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        raise _bad_reply(text, "RCON returned no reply")
    try:
        reply = json.loads(text)
    except json.JSONDecodeError:
        raise _bad_reply(text, f"the reply is not one JSON object: {text[:120]}") from None
    if not isinstance(reply, dict):
        raise _bad_reply(text, "the reply is not one JSON object")
    if reply.get("v") != 1:
        raise _bad_reply(text, "the reply has no version 1")
    if reply.get("id") != request_id:
        raise _bad_reply(text, "the reply id does not match the request id")
    return reply


def _bad_reply(raw: str, message: str) -> RpcProtocolError:
    logger.bind(reply=raw[:120]).warning("rpc_bad_reply")
    return RpcProtocolError("bad_reply", message)
