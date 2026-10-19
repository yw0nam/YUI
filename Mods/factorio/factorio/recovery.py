"""Map-change recovery shared by a stale session and an observed map change."""

from loguru import logger

from factorio.doorbell import Doorbell
from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog


class MapRecovery:
    """Adopt a new map from `status` and flag the next doorbell."""

    def __init__(self, session: Session, doorbell: Doorbell, log: OutcomeLog):
        self._session = session
        self._doorbell = doorbell
        self._log = log

    async def run(self, status: dict) -> None:
        self._session.on_map_change(status)
        self._doorbell.mark_reset()
        self._log.session_reset(
            cause="map_change",
            poll_cursor=self._session.poll_cursor,
            backend_cursor=self._session.backend_cursor,
        )
        logger.bind(map_id=self._session.map_id, seq=self._session.poll_cursor).info("session_reset")
