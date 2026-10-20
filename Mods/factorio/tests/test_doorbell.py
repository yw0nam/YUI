"""Doorbell: coalescing, one POST in flight, cumulative ranges, re-post, reset, note."""

import asyncio
import json

import httpx
import pytest

from factorio.config import DEFAULT_WAKE_KINDS
from factorio.doorbell import Doorbell
from factorio.events.cache import Session
from factorio.outcome_log import OutcomeLog

WAKE_KINDS = ("chat", "job_done", "job_failed")
CLOCK_MS = 1_700_000_000_500


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


class Raise:
    def __init__(self, error: Exception):
        self.error = error

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        raise self.error


def make_bell(tmp_path, recorder, kinds: tuple[str, ...] = WAKE_KINDS):
    session = Session()
    session.map_id = "map-a"
    session.on_map_change({"map_id": "map-a", "seq": 0})
    client = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
    bell = Doorbell(
        "http://127.0.0.1:8770/signals",
        kinds,
        session,
        OutcomeLog(tmp_path / "outcome.jsonl"),
        coalesce_ms=2000,
        client=client,
        clock=lambda: CLOCK_MS / 1000,
    )
    return bell, Feed(session), session, client


class Feed:
    """Adds polled events to the session the way the poller does."""

    def __init__(self, session: Session):
        self.session = session

    def add(self, item: dict) -> None:
        self.session.on_page({"map_id": "map-a", "head_seq": item["seq"], "events": [item]})


def records(tmp_path):
    path = tmp_path / "outcome.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_two_wake_events_inside_the_coalesce_window_post_once(tmp_path):
    recorder = Recorder([200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "chat", "hello"))
        bell.notify(event(1, "chat", "hello"), now=0.0)
        await bell.step(1.9)
        assert recorder.bodies == []
        feed.add(event(2, "job_done"))
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
    assert envelope["occurred_at"] == CLOCK_MS


def test_a_wake_event_during_a_pending_post_waits_for_its_200(tmp_path):
    gate = asyncio.Event()
    recorder = Recorder([200, 200], gate=gate)
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "chat", "hello"))
        bell.notify(event(1, "chat", "hello"), now=0.0)
        pending = asyncio.create_task(bell.step(2.0))
        await recorder.started.wait()
        feed.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=2.0)
        await bell.step(2.1)
        assert len(recorder.bodies) == 1
        gate.set()
        await pending
        await bell.step(4.2)
        await client.aclose()

    asyncio.run(case())
    assert [body["signals"][0]["pending_to_seq"] for body in recorder.bodies] == [1, 2]


def test_a_500_then_a_200_posts_the_cumulative_range(tmp_path):
    recorder = Recorder([500, 200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "chat", "hello"))
        bell.notify(event(1, "chat", "hello"), now=0.0)
        await bell.step(2.0)
        assert len(recorder.bodies) == 1
        feed.add(event(2, "job_done"))
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


def test_unread_wake_events_post_once_more_after_five_minutes(tmp_path):
    recorder = Recorder([200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        await bell.step(301.9)
        assert len(recorder.bodies) == 1
        await bell.step(302.0)
        await bell.step(602.5)
        assert len(recorder.bodies) == 2
        feed.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=603.0)
        await bell.step(605.1)
        assert len(recorder.bodies) == 3
        await bell.step(905.2)
        assert len(recorder.bodies) == 4
        await client.aclose()

    asyncio.run(case())


def ranges(recorder) -> list[tuple[int, int]]:
    return [
        (body["signals"][0]["pending_from_seq"], body["signals"][0]["pending_to_seq"])
        for body in recorder.bodies
    ]


def test_a_range_first_posted_by_a_failed_reposts_retry_is_reposted_once(tmp_path):
    recorder = Recorder([200, 500, 200, 200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        await bell.step(302.0)
        feed.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=303.0)
        await bell.step(307.0)
        await bell.step(606.9)
        await bell.step(607.0)
        await bell.step(907.1)
        await client.aclose()

    asyncio.run(case())
    assert ranges(recorder) == [(1, 1), (1, 1), (1, 2), (1, 2)]


def test_a_reset_clears_the_repost_mark_so_a_new_range_ending_at_the_same_seq_reposts_once(tmp_path):
    recorder = Recorder([200])
    bell, feed, session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        await bell.step(302.0)
        bell.mark_reset()
        session.on_map_change({"map_id": "map-a", "seq": 0})
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=303.0)
        await bell.step(305.0)
        await bell.step(604.9)
        await bell.step(605.0)
        await bell.step(905.1)
        await client.aclose()

    asyncio.run(case())
    assert ranges(recorder) == [(1, 1), (1, 1), (1, 1), (1, 1)]


def test_a_non_wake_event_after_a_repost_does_not_repost_again(tmp_path):
    recorder = Recorder([200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        await bell.step(302.0)
        feed.add(event(2, "snapshot_summary"))
        bell.notify(event(2, "snapshot_summary"), now=303.0)
        await bell.step(602.1)
        await client.aclose()

    asyncio.run(case())
    assert ranges(recorder) == [(1, 1), (1, 1)]


class RaiseOnce:
    """Raises a non-httpx error on the first request, then answers 200."""

    def __init__(self):
        self.bodies: list[dict] = []
        self.calls = 0

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("boom")
        self.bodies.append(json.loads(request.content))
        return httpx.Response(200, json={})


def test_a_post_that_raises_a_non_http_error_leaves_the_doorbell_able_to_post(tmp_path):
    recorder = RaiseOnce()
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        with pytest.raises(RuntimeError, match="boom"):
            await bell.step(2.0)
        feed.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=3.0)
        await bell.step(5.0)
        await client.aclose()

    asyncio.run(case())
    assert ranges(recorder) == [(1, 2)]


def test_a_range_the_backend_already_read_posts_nothing(tmp_path):
    recorder = Recorder([200])
    bell, feed, session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        session.read(None, 200)
        await bell.step(2.0)
        feed.add(event(2, "job_failed"))
        bell.notify(event(2, "job_failed"), now=10.0)
        await bell.step(12.0)
        await client.aclose()

    asyncio.run(case())
    assert ranges(recorder) == [(2, 2)]


def test_reset_is_sent_once_after_recovery(tmp_path):
    recorder = Recorder([200, 200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        bell.mark_reset()
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        feed.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=2.1)
        await bell.step(4.2)
        await client.aclose()

    asyncio.run(case())
    assert [body["signals"][0]["reset"] for body in recorder.bodies] == [True, False]


def test_a_recovery_during_a_pending_post_sets_reset_on_the_next_post(tmp_path):
    gate = asyncio.Event()
    recorder = Recorder([200, 200], gate=gate)
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        pending = asyncio.create_task(bell.step(2.0))
        await recorder.started.wait()
        bell.mark_reset()
        feed.add(event(2, "job_done"))
        bell.notify(event(2, "job_done"), now=2.1)
        gate.set()
        await pending
        await bell.step(4.2)
        await client.aclose()

    asyncio.run(case())
    assert [body["signals"][0]["reset"] for body in recorder.bodies] == [False, True]


@pytest.mark.parametrize(
    ("events", "note"),
    [
        (
            [event(1, "chat", "first line"), event(2, "chat", "second line"), event(3, "job_done")],
            "second line",
        ),
        ([event(1, "job_done"), event(2, "job_failed")], "job_done, job_failed"),
    ],
)
def test_note_is_the_newest_unread_chat_text_or_the_unread_wake_kinds(tmp_path, events, note):
    recorder = Recorder([200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        for item in events:
            feed.add(item)
        bell.notify(events[-1], now=0.0)
        await bell.step(2.0)
        await client.aclose()

    asyncio.run(case())
    assert recorder.bodies[0]["signals"][0]["note"] == note


def test_a_kind_outside_the_wake_list_never_posts(tmp_path):
    recorder = Recorder([200])
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "tick"))
        bell.notify(event(1, "tick"), now=0.0)
        await bell.step(30.0)
        await client.aclose()

    asyncio.run(case())
    assert recorder.bodies == []


@pytest.mark.parametrize(
    ("kind", "posts"),
    [
        ("stopped", True),
        ("queue_idle", True),
        ("job_done", False),
    ],
)
def test_the_default_wake_set_rings_for_stopped_and_queue_idle_only(tmp_path, kind, posts):
    recorder = Recorder([200])
    bell, feed, _session, client = make_bell(tmp_path, recorder, kinds=DEFAULT_WAKE_KINDS)

    async def case():
        feed.add(event(1, kind))
        bell.notify(event(1, kind), now=0.0)
        await bell.step(2.0)
        await client.aclose()

    asyncio.run(case())
    assert len(recorder.bodies) == (1 if posts else 0)


@pytest.mark.parametrize(
    ("recorder", "status", "error"),
    [
        (Recorder([500]), 500, None),
        (Raise(httpx.ConnectError("boom")), None, "ConnectError"),
    ],
)
def test_a_failed_post_records_the_http_status_or_the_exception_class(tmp_path, recorder, status, error):
    bell, feed, _session, client = make_bell(tmp_path, recorder)

    async def case():
        feed.add(event(1, "job_done"))
        bell.notify(event(1, "job_done"), now=0.0)
        await bell.step(2.0)
        await client.aclose()

    asyncio.run(case())
    record = [item for item in records(tmp_path) if item["type"] == "doorbell"][-1]
    assert (record["status"], record.get("error")) == (status, error)
