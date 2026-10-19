"""The one-second poll loop that fills the cache and rings the doorbell."""

import asyncio

from loguru import logger

from factorio.events.cache import PAGE_LIMIT, Session
from factorio.recovery import MapRecovery
from factorio.rpc import RpcClient, RpcError, RpcUnavailable

INTERVAL_S = 1.0


class Poller:
    def __init__(
        self,
        rpc: RpcClient,
        session: Session,
        doorbell,
        recovery: MapRecovery,
        log,
        interval: float = INTERVAL_S,
    ):
        self.rpc = rpc
        self.session = session
        self.doorbell = doorbell
        self.recovery = recovery
        self.log = log
        self.interval = interval

    async def run(self) -> None:
        while True:
            delay = self.interval
            try:
                await self.poll_once()
            except RpcUnavailable as err:
                delay = self.rpc.retry_delay()
                logger.bind(code=err.code, delay=delay).warning("poll_unavailable")
            except RpcError as err:
                logger.bind(code=err.code).warning("poll_rejected")
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — one bad page must not stop the poll loop
                delay = 5.0
                logger.exception("poll_failed")
            await asyncio.sleep(delay)

    async def poll_once(self) -> None:
        if self.session.map_id is None:
            await self._sync_status()
        while True:
            previous_cursor = self.session.poll_cursor
            try:
                page = await self.rpc.call(
                    "events_since", {"seq": self.session.poll_cursor, "limit": PAGE_LIMIT}
                )
            except RpcError as err:
                if err.code == "history_gap":
                    oldest = int((err.result or {}).get("oldest_seq", 0))
                    self.session.on_history_gap(oldest)
                    self.log.history_gap(oldest_seq=oldest)
                    logger.bind(oldest_seq=oldest, poll_cursor=self.session.poll_cursor).info("history_gap")
                    continue
                raise

            result = self.session.on_page(page)
            if result.outcome == "map_change":
                await self.recovery.run(await self.rpc.status())
                return
            if result.outcome == "rollback":
                self.doorbell.mark_reset()
                self.log.session_reset(
                    cause="rollback",
                    poll_cursor=self.session.poll_cursor,
                    backend_cursor=self.session.backend_cursor,
                )
                logger.bind(
                    poll_cursor=self.session.poll_cursor,
                    backend_cursor=self.session.backend_cursor,
                ).info("session_reset")
                return

            self._log_lag(result.dropped)
            events = page.get("events") or []
            for event in events:
                self.log.event(event)
                self.doorbell.notify(event)
            if len(events) < PAGE_LIMIT or self.session.poll_cursor == previous_cursor:
                return

    async def _sync_status(self) -> None:
        status = await self.rpc.status()
        self.session.on_map_change(status)
        logger.bind(map_id=self.session.map_id, seq=self.session.poll_cursor).info("session_started")

    def _log_lag(self, dropped: tuple[int, ...]) -> None:
        unread = [seq for seq in dropped if seq > self.session.backend_cursor]
        if unread:
            self.log.backend_lag(dropped=len(dropped))
            logger.bind(
                dropped=len(dropped),
                oldest_unread=min(unread),
                backend_cursor=self.session.backend_cursor,
            ).warning("backend_lag")
