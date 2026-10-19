"""Bounded event cache and the session cursors that drive polling and reads."""

from collections import OrderedDict
from dataclasses import dataclass

DEFAULT_CAPACITY = 5000
PAGE_LIMIT = 200  # the most the game mod returns per events_since call


class EventCache:
    """Events in sequence order, bounded to `capacity`; the oldest leaves first."""

    def __init__(self, capacity: int = DEFAULT_CAPACITY):
        self.capacity = capacity
        self._events: OrderedDict[int, dict] = OrderedDict()

    def add(self, event: dict) -> tuple[int, ...]:
        seq = int(event["seq"])
        self._events[seq] = event
        dropped: list[int] = []
        while len(self._events) > self.capacity:
            old_seq, _ = self._events.popitem(last=False)
            dropped.append(old_seq)
        return tuple(dropped)

    def events_after(self, seq: int) -> list[dict]:
        return [event for event_seq, event in self._events.items() if event_seq > seq]

    def page_after(self, seq: int, limit: int) -> list[dict]:
        page: list[dict] = []
        previous = seq
        for event_seq, event in self._events.items():
            if event_seq <= seq:
                continue
            if page and event_seq != previous + 1:
                break
            page.append(event)
            previous = event_seq
            if len(page) >= limit:
                break
        return page

    def has_after(self, seq: int) -> bool:
        return any(event_seq > seq for event_seq in self._events)

    def drop_above(self, seq: int) -> None:
        for event_seq in [event_seq for event_seq in self._events if event_seq > seq]:
            del self._events[event_seq]

    def clear(self) -> None:
        self._events.clear()

    @property
    def newest_seq(self) -> int | None:
        return next(reversed(self._events), None)

    @property
    def oldest_seq(self) -> int | None:
        return next(iter(self._events), None)


@dataclass(frozen=True)
class PageResult:
    outcome: str
    dropped: tuple[int, ...] = ()


class Session:
    """The poll cursor, the backend read cursor, and the current map id."""

    def __init__(self):
        self.map_id: str | None = None
        self.poll_cursor = 0
        self.backend_cursor = 0

    def on_page(self, page: dict, cache: EventCache) -> PageResult:
        map_id = page.get("map_id")
        if self.map_id is not None and map_id != self.map_id:
            return PageResult("map_change")
        if self.map_id is None:
            self.map_id = map_id
        head_seq = int(page["head_seq"])
        if head_seq < self.poll_cursor:
            self.poll_cursor = head_seq
            self.backend_cursor = min(self.backend_cursor, head_seq)
            cache.drop_above(head_seq)
            return PageResult("rollback")
        dropped: tuple[int, ...] = ()
        for event in page.get("events", []):
            dropped += cache.add(event)
        self.poll_cursor = max(self.poll_cursor, head_seq)
        return PageResult("ok", dropped)

    def on_history_gap(self, oldest_seq: int) -> None:
        self.poll_cursor = max(0, oldest_seq - 1)

    def on_map_change(self, status: dict, cache: EventCache | None = None) -> None:
        self.map_id = status["map_id"]
        self.poll_cursor = int(status["seq"])
        self.backend_cursor = self.poll_cursor
        if cache is not None:
            cache.clear()

    def read(self, cache: EventCache, since_seq: int | None, limit: int) -> dict:
        base = self.backend_cursor if since_seq is None else min(since_seq, self.backend_cursor)
        events = cache.page_after(base, limit)
        next_seq = int(events[-1]["seq"]) if events else base
        self.backend_cursor = max(self.backend_cursor, next_seq)
        return {"events": events, "next_seq": next_seq, "more": cache.has_after(next_seq)}
