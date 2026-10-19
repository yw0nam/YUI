"""Session resets: the shared recorder and the map-change recovery."""

from typing import Literal

from loguru import logger

from factorio.doorbell import Doorbell
from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog


def record_reset(
    session: Session, doorbell: Doorbell, log: OutcomeLog, cause: Literal["rollback", "map_change"]
) -> None:
    """Flag the next doorbell, then record the reset with its cause and both cursors."""
    doorbell.mark_reset()
    log.session_reset(cause=cause, poll_cursor=session.poll_cursor, backend_cursor=session.backend_cursor)
    logger.bind(
        cause=cause,
        map_id=session.map_id,
        poll_cursor=session.poll_cursor,
        backend_cursor=session.backend_cursor,
    ).info("session_reset")


class MapRecovery:
    """Adopt a new map from `status` and flag the next doorbell."""

    def __init__(self, session: Session, doorbell: Doorbell, log: OutcomeLog):
        self._session = session
        self._doorbell = doorbell
        self._log = log

    async def run(self, status: dict) -> None:
        self._session.on_map_change(status)
        record_reset(self._session, self._doorbell, self._log, "map_change")
