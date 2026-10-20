"""Session resets: the shared recorder and the map-change recovery."""

from typing import Literal

from loguru import logger

from factorio.doorbell import Doorbell
from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog
from factorio.rpc import RpcClient, RpcError

ACTIVE_STATES = ("queued", "running")


async def record_reset(
    rpc: RpcClient,
    session: Session,
    doorbell: Doorbell,
    log: OutcomeLog,
    cause: Literal["rollback", "map_change"],
) -> None:
    """Flag the next doorbell, re-read the queue, and record the reset."""
    doorbell.mark_reset()
    queue_length = await _queue_length(rpc)
    log.session_reset(
        cause=cause,
        poll_cursor=session.poll_cursor,
        backend_cursor=session.backend_cursor,
        queue_length=queue_length,
    )
    logger.bind(
        cause=cause,
        map_id=session.map_id,
        poll_cursor=session.poll_cursor,
        backend_cursor=session.backend_cursor,
        queue_length=queue_length,
    ).info("session_reset")


async def _queue_length(rpc: RpcClient) -> int | None:
    try:
        records = await rpc.call("jobs", {})
    except RpcError as err:
        logger.bind(code=err.code).warning("reset_queue_unread")
        return None
    if not isinstance(records, list):
        return 0
    return sum(1 for record in records if isinstance(record, dict) and record.get("state") in ACTIVE_STATES)


class MapRecovery:
    """Adopt a new map from `status` and flag the next doorbell."""

    def __init__(self, session: Session, doorbell: Doorbell, log: OutcomeLog):
        self._session = session
        self._doorbell = doorbell
        self._log = log

    async def run(self, rpc: RpcClient, status: dict, generation: int) -> None:
        """Adopt `status`, unless a recovery since `generation` already adopted its map."""
        if self._session.generation != generation and self._session.adopted_map_id == status.get("map_id"):
            return
        self._session.on_map_change(status)
        await record_reset(rpc, self._session, self._doorbell, self._log, "map_change")
