"""Doorbell: coalescing, one POST in flight, cumulative ranges, re-post, reset, note."""

import asyncio
import json

import httpx

from factorio.doorbell import Doorbell
from factorio.events.cache import EventCache, Session
from factorio.outcome_log import OutcomeLog

WAKE_KINDS = ("chat", "job_done", "job_failed")


def event(seq: int, kind: str = "chat", text: str | None = None) -> dict:
    data = {} if text is None else {"text": text}
    return {"seq": seq, "tick": seq * 60, "kind": kind, "data": data}


class Recorder:
    """A fake signals endpoint that scripts status codes and can hold one request."""

    def __init__(self, statuses: list[int], gate: asyncio.Event | None = None):
        self.statuses = statuses
        self.gate = gate
        self.started = asyncio.Event()
        self.bodies: list[dict] = []

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.bodies.append(json.loads(request.content))
        status = self.statuses[min(len(self.bodies) - 1, len(self.statuses) - 1)]
        if self.gate is not None and len(self.bodies) == 1:
            self.started.set()
            await self.gate.wait()
        return httpx.Response(status, json={})


def make_bell(tmp_path, recorder: Recorder, kinds: tuple[str, ...] = WAKE_KINDS):
    cache = EventCache()
    session = Session()
    session.on_map_change({"map_id": "map-a", "seq": 0})
    client = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
    bell = Doorbell(
        "http://127.0.0.1:8770/signals",
        kinds,
        cache,
        session,
        OutcomeLog(tmp_path / "outcome.jsonl"),
        client=client,
    )
    return bell, cache, session, client


def test_two_wake_events_inside_the_coalesce_window_post_once(tmp_path):
    recorder = Recorder([200])
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        cache.add(event(1, "chat", "hello"))
        bell.notify(event(1, "chat", "hello"), now=0.0)
        await bell.step(1.9)
        assert recorder.bodies == []
        cache.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=1.0)
        await bell.step(2.0)
        await client.aclose()

    asyncio.run(case())
    assert len(recorder.bodies) == 1
    signal = recorder.bodies[0]["signals"][0]
    assert (signal["kind"], signal["pending_from_seq"], signal["pending_to_seq"]) == ("factorio", 1, 2)
    envelope = recorder.bodies[0]["envelope"]
    assert (envelope["source"], envelope["event_type"], envelope["delivery"]) == (
        "factorio",
        "game.wake",
        "live",
    )
    assert isinstance(envelope["occurred_at"], int)


def test_a_wake_event_during_a_pending_post_waits_for_its_200(tmp_path):
    gate = asyncio.Event()
    recorder = Recorder([200, 200], gate=gate)
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        cache.add(event(1, "chat", "hello"))
        bell.notify(event(1, "chat", "hello"), now=0.0)
        pending = asyncio.create_task(bell.step(2.0))
        await recorder.started.wait()
        cache.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=2.0)
        await bell.step(2.1)
        assert len(recorder.bodies) == 1
        gate.set()
        await pending
        await bell.step(4.2)
        await client.aclose()

    asyncio.run(case())
    assert [body["signals"][0]["pending_to_seq"] for body in recorder.bodies] == [1, 2]
    assert len(recorder.bodies) == 2


def test_a_500_then_a_200_posts_the_cumulative_range(tmp_path):
    recorder = Recorder([500, 200])
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        cache.add(event(1, "chat", "hello"))
        bell.notify(event(1, "chat", "hello"), now=0.0)
        await bell.step(2.0)
        assert len(recorder.bodies) == 1
        cache.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=2.5)
        await bell.step(6.9)
        assert len(recorder.bodies) == 1
        await bell.step(7.0)
        await client.aclose()

    asyncio.run(case())
    assert [
        (body["signals"][0]["pending_from_seq"], body["signals"][0]["pending_to_seq"])
        for body in recorder.bodies
    ] == [(1, 1), (1, 2)]


def test_unread_wake_events_post_again_after_five_minutes(tmp_path):
    recorder = Recorder([200, 200])
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        cache.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        await bell.step(301.9)
        assert len(recorder.bodies) == 1
        await bell.step(302.0)
        await client.aclose()

    asyncio.run(case())
    assert len(recorder.bodies) == 2


def test_reset_is_sent_once_after_recovery(tmp_path):
    recorder = Recorder([200, 200])
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        bell.mark_reset()
        cache.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        cache.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=2.1)
        await bell.step(4.2)
        await client.aclose()

    asyncio.run(case())
    assert [body["signals"][0]["reset"] for body in recorder.bodies] == [True, False]


def test_note_is_the_newest_unread_chat_text_verbatim(tmp_path):
    recorder = Recorder([200])
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        cache.add(event(1, "chat", "first line"))
        cache.add(event(2, "chat", "second line"))
        cache.add(event(3, "job_done"))
        bell.notify(event(3, "job_done"), now=0.0)
        await bell.step(2.0)
        await client.aclose()

    asyncio.run(case())
    assert recorder.bodies[0]["signals"][0]["note"] == "second line"


def test_note_falls_back_to_the_unread_wake_kinds(tmp_path):
    recorder = Recorder([200])
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        cache.add(event(1, "job_done"))
        cache.add(event(2, "job_failed"))
        bell.notify(event(2, "job_failed"), now=0.0)
        await bell.step(2.0)
        await client.aclose()

    asyncio.run(case())
    assert recorder.bodies[0]["signals"][0]["note"] == "job_done, job_failed"


def test_a_kind_outside_the_wake_list_never_posts(tmp_path):
    recorder = Recorder([200])
    bell, cache, _session, client = make_bell(tmp_path, recorder)

    async def case():
        cache.add(event(1, "tick"))
        bell.notify(event(1, "tick"), now=0.0)
        await bell.step(30.0)
        await client.aclose()

    asyncio.run(case())
    assert recorder.bodies == []
