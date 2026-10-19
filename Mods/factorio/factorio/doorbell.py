"""The coalesced, single-flight doorbell to the YUI signals ingress."""

import asyncio
import time
import uuid
from typing import Any

import httpx
from loguru import logger

from factorio.config import DOORBELL_TIMEOUT_S
from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog

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
        session: Session,
        log: OutcomeLog,
        *,
        coalesce_ms: int,
        client: httpx.AsyncClient | None = None,
        clock=time.time,
    ):
        self._url = url
        self._kinds = set(kinds)
        self._session = session
        self._log = log
        self._coalesce_s = coalesce_ms / 1000
        self._client = client or httpx.AsyncClient(timeout=DOORBELL_TIMEOUT_S)
        self._owns_client = client is None
        self._clock = clock
        self._dirty_at: float | None = None
        self._retry_at: float | None = None
        self._retry_s = RETRY_START_S
        self._last_ok_at: float | None = None
        self._reposted_to_seq: int | None = None
        self._reset_generation = 0
        self._cleared_generation = 0
        self._in_flight = False

    def notify(self, event: dict, now: float | None = None) -> None:
        if event.get("kind") not in self._kinds:
            return
        if self._dirty_at is None:
            self._dirty_at = time.monotonic() if now is None else now

    def mark_reset(self) -> None:
        self._reset_generation += 1
        self._reposted_to_seq = None

    async def step(self, now: float) -> None:
        if self._in_flight:
            return
        if self._retry_at is not None:
            if now >= self._retry_at:
                await self._post(now, repost=False)
            return
        if self._dirty_at is not None:
            if now - self._dirty_at >= self._coalesce_s:
                await self._post(now, repost=False)
            return
        if self._last_ok_at is not None and now - self._last_ok_at >= REPOST_AFTER_S:
            unread = self._session.unread_wake_events(self._kinds)
            if unread and unread[-1]["seq"] != self._reposted_to_seq:
                await self._post(now, repost=True)

    async def run(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.step(time.monotonic())
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — one bad tick must not stop the doorbell loop
                logger.exception("doorbell_tick_failed")

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _post(self, now: float, repost: bool) -> None:
        unread = self._session.unread_wake_events(self._kinds)
        if not unread:
            self._dirty_at = None
            self._retry_at = None
            return
        generation = self._reset_generation
        body = self._build(generation, unread)
        self._in_flight = True
        dirty = self._dirty_at
        self._dirty_at = None
        try:
            response = await self._client.post(self._url, json=body)
        except httpx.HTTPError as err:
            self._fail(now, dirty, body, status=None, error=type(err).__name__)
            return
        finally:
            self._in_flight = False
        if 200 <= response.status_code < 300:
            self._last_ok_at = now
            self._retry_at = None
            self._retry_s = RETRY_START_S
            self._cleared_generation = max(self._cleared_generation, generation)
            if repost:
                self._reposted_to_seq = unread[-1]["seq"]
            self._record(status=response.status_code, body=body)
            logger.bind(status=response.status_code, pending=body["signals"][0]).info("doorbell_posted")
        else:
            self._fail(now, dirty, body, status=response.status_code, error=None)

    def _fail(
        self,
        now: float,
        dirty: float | None,
        body: dict[str, Any],
        *,
        status: int | None,
        error: str | None,
    ) -> None:
        if self._dirty_at is None:
            self._dirty_at = dirty
        self._retry_at = now + self._retry_s
        self._retry_s = min(self._retry_s * 2, RETRY_CAP_S)
        reason = f"HTTP {status}" if status is not None else error
        logger.bind(reason=reason, retry_in=self._retry_s).warning("doorbell_post_failed")
        self._record(status=status, body=body, error=error)

    def _build(self, generation: int, unread: list[dict]) -> dict[str, Any]:
        note = None
        kinds: list[str] = []
        for event in unread:
            text = _chat_text(event)
            if text is not None:
                note = text
            if event["kind"] not in kinds:
                kinds.append(event["kind"])
        return {
            "signals": [
                {
                    "kind": "factorio",
                    "note": note if note is not None else ", ".join(kinds),
                    "pending_from_seq": self._session.backend_cursor + 1,
                    "pending_to_seq": self._session.newest_seq,
                    "reset": generation > self._cleared_generation,
                }
            ],
            "envelope": {
                "source": "factorio",
                "event_type": "game.wake",
                "delivery": "live",
                "event_id": str(uuid.uuid4()),
                "occurred_at": int(self._clock() * 1000),
            },
        }

    def _record(self, *, status: int | None, body: dict[str, Any], error: str | None = None) -> None:
        signal = body["signals"][0]
        self._log.doorbell(
            status=status,
            pending_from_seq=signal["pending_from_seq"],
            pending_to_seq=signal["pending_to_seq"],
            reset=signal["reset"],
            error=error,
        )


def _chat_text(event: dict) -> str | None:
    if event.get("kind") != "chat" or not isinstance(event.get("data"), dict):
        return None
    text = event["data"].get("text")
    return text if isinstance(text, str) and text else None
