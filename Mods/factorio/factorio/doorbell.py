"""The coalesced, single-flight doorbell to the YUI signals ingress."""

import asyncio
import time
import uuid
from typing import Any

import httpx
from loguru import logger

from factorio.events.cache import EventCache, Session

COALESCE_MS = 2000
REPOST_AFTER_S = 300.0
RETRY_START_S = 5.0
RETRY_CAP_S = 300.0
TICK_S = 0.05


class Doorbell:
    """Post one `delivery: live` group when a wake-kind event arrives."""

    def __init__(
        self,
        url: str,
        kinds: tuple[str, ...],
        cache: EventCache,
        session: Session,
        log,
        *,
        coalesce_ms: int = COALESCE_MS,
        client: httpx.AsyncClient | None = None,
    ):
        self._url = url
        self._kinds = set(kinds)
        self._cache = cache
        self._session = session
        self._log = log
        self._coalesce_s = coalesce_ms / 1000
        self._client = client or httpx.AsyncClient(timeout=10.0)
        self._owns_client = client is None
        self._dirty_at: float | None = None
        self._retry_at: float | None = None
        self._retry_s = RETRY_START_S
        self._last_ok_at: float | None = None
        self._reset = False
        self._in_flight = False

    def notify(self, event: dict, now: float | None = None) -> None:
        if event.get("kind") not in self._kinds:
            return
        if self._dirty_at is None:
            self._dirty_at = time.monotonic() if now is None else now

    def mark_reset(self) -> None:
        self._reset = True

    async def step(self, now: float) -> None:
        if self._in_flight:
            return
        if self._retry_at is not None:
            if now >= self._retry_at:
                await self._post(now)
            return
        if self._dirty_at is not None:
            if now - self._dirty_at >= self._coalesce_s:
                await self._post(now)
            return
        if (
            self._last_ok_at is not None
            and now - self._last_ok_at >= REPOST_AFTER_S
            and self._unread_wake_events()
        ):
            await self._post(now)

    async def run(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.step(time.monotonic())
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — one bad tick must not stop the doorbell loop
                logger.exception("doorbell_failed")

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _post(self, now: float) -> None:
        body = self._build()
        self._in_flight = True
        dirty = self._dirty_at
        self._dirty_at = None
        try:
            response = await self._client.post(self._url, json=body)
        except httpx.HTTPError as err:
            self._fail(now, dirty, str(err))
            return
        self._in_flight = False
        if 200 <= response.status_code < 300:
            self._last_ok_at = now
            self._retry_at = None
            self._retry_s = RETRY_START_S
            self._reset = False
            self._record(response.status_code, body)
            logger.bind(status=response.status_code, pending=body["signals"][0]).info("doorbell_posted")
        else:
            self._fail(now, dirty, f"HTTP {response.status_code}")

    def _fail(self, now: float, dirty: float | None, reason: str) -> None:
        self._in_flight = False
        if self._dirty_at is None:
            self._dirty_at = dirty
        self._retry_at = now + self._retry_s
        self._retry_s = min(self._retry_s * 2, RETRY_CAP_S)
        logger.bind(reason=reason, retry_in=self._retry_s).warning("doorbell_failed")
        self._log.doorbell(
            status=None,
            pending_from_seq=self._session.backend_cursor + 1,
            pending_to_seq=self._pending_to_seq(),
            reset=self._reset,
        )

    def _build(self) -> dict[str, Any]:
        unread = self._cache.events_after(self._session.backend_cursor)
        note = None
        kinds: list[str] = []
        for event in unread:
            text = _chat_text(event)
            if text is not None:
                note = text
            kind = event.get("kind")
            if kind in self._kinds and kind not in kinds:
                kinds.append(kind)
        return {
            "signals": [
                {
                    "kind": "factorio",
                    "note": note if note is not None else ", ".join(kinds),
                    "pending_from_seq": self._session.backend_cursor + 1,
                    "pending_to_seq": self._pending_to_seq(),
                    "reset": self._reset,
                }
            ],
            "envelope": {
                "source": "factorio",
                "event_type": "game.wake",
                "delivery": "live",
                "event_id": str(uuid.uuid4()),
                "occurred_at": int(time.time() * 1000),
            },
        }

    def _pending_to_seq(self) -> int:
        newest = self._cache.newest_seq
        return self._session.backend_cursor if newest is None else newest

    def _unread_wake_events(self) -> bool:
        return any(
            event.get("kind") in self._kinds
            for event in self._cache.events_after(self._session.backend_cursor)
        )

    def _record(self, status: int, body: dict[str, Any]) -> None:
        signal = body["signals"][0]
        self._log.doorbell(
            status=status,
            pending_from_seq=signal["pending_from_seq"],
            pending_to_seq=signal["pending_to_seq"],
            reset=signal["reset"],
        )


def _chat_text(event: dict) -> str | None:
    if event.get("kind") != "chat" or not isinstance(event.get("data"), dict):
        return None
    text = event["data"].get("text")
    return text if isinstance(text, str) and text else None
