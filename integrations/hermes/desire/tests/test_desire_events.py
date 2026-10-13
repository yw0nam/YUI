import json
from contextlib import contextmanager

import pytest

import desire_events
import desire_store


def event(event_id, at="2026-08-25T12:00:00+09:00", fact="fact", source="monitor", source_ref=None):
    return {"id": event_id, "at": at, "fact": fact, "source": source, "source_ref": source_ref}


def unread(state_dir, lines, readings=()):
    (state_dir / "events.jsonl").write_text(
        "".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8"
    )
    (state_dir / "readings.jsonl").write_text(
        "".join(json.dumps(line) + "\n" for line in readings), encoding="utf-8"
    )
    return desire_events.unread_event_ids(state_dir)


def test_plain_events_come_back_in_file_order(state_dir):
    assert unread(state_dir, [event("e-000002"), event("e-000001")]) == ["e-000002", "e-000001"]


def test_a_second_line_with_a_known_id_is_ignored(state_dir):
    lines = [event("e-000001", fact="first"), event("e-000001", fact="second")]

    assert unread(state_dir, lines) == ["e-000001"]


def test_retracted_and_read_events_do_not_count(state_dir):
    lines = [
        event("e-000001"),
        event("e-000002"),
        event("e-000003"),
        {"retracts": "e-000002", "at": "2026-08-25T13:00:00+09:00", "why": "wrong"},
    ]
    readings = [{"id": "r-000001", "event_id": "e-000003", "at": "2026-08-25T13:00:00+09:00", "text": "mine"}]

    assert unread(state_dir, lines, readings) == ["e-000001"]


def test_a_reading_line_inside_the_event_log_reads_nothing(state_dir):
    lines = [
        event("e-000001"),
        {"id": "r-000001", "event_id": "e-000001", "at": "2026-08-25T13:00:00+09:00", "text": "mine"},
    ]

    assert unread(state_dir, lines) == ["e-000001"]


def test_a_retraction_or_reading_naming_an_unknown_event_is_ignored(state_dir):
    lines = [
        event("e-000001"),
        {"retracts": "e-000009", "at": "2026-08-25T13:00:00+09:00", "why": "wrong"},
    ]
    readings = [{"id": "r-000001", "event_id": "e-000009", "at": "2026-08-25T13:00:00+09:00", "text": "mine"}]

    assert unread(state_dir, lines, readings) == ["e-000001"]


def test_a_correction_line_is_not_an_event_and_leaves_its_target_unread(state_dir):
    lines = [
        event("e-000001", fact="wrong"),
        {"corrects": "e-000001", "at": "2026-08-25T13:00:00+09:00", "fact": "right"},
    ]

    assert unread(state_dir, lines) == ["e-000001"]


def test_malformed_and_non_object_lines_are_skipped(state_dir):
    path = state_dir / "events.jsonl"
    lines = [
        event("e-000001"),
        event("e-000002"),
        {"id": "e-000003", "at": "nope", "fact": "x", "source": "agent", "source_ref": None},
        {
            "id": "e-000004",
            "at": "2026-08-25T12:00:00+09:00",
            "fact": "",
            "source": "agent",
            "source_ref": None,
        },
        {
            "id": "e-000005",
            "at": "2026-08-25T12:00:00+09:00",
            "fact": "x",
            "source": "ghost",
            "source_ref": None,
        },
        {
            "id": "xyz123",
            "at": "2026-08-25T12:00:00+09:00",
            "fact": "x",
            "source": "agent",
            "source_ref": None,
        },
        {"id": "r-000001", "event_id": "e-000001", "at": "bad", "text": "x"},
        {"retracts": 7, "at": "2026-08-25T12:00:00+09:00", "why": "x"},
    ]
    path.write_text(
        "{not json}\n"
        + json.dumps(["not", "an", "object"])
        + "\n"
        + "".join(json.dumps(line) + "\n" for line in lines),
        encoding="utf-8",
    )

    assert desire_events.unread_event_ids(state_dir) == ["e-000001", "e-000002"]


def test_a_missing_log_reads_as_empty(state_dir):
    assert desire_events.unread_event_ids(state_dir) == []


def test_the_writers_append_and_never_rewrite(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    event_id = desire_events.file_event(state_dir, "  issue was closed  ", "monitor", "https://x/1", now)
    reading_id = desire_events.file_reading(state_dir, event_id, " it landed ", now)
    events_before = (state_dir / "events.jsonl").read_bytes()
    readings_before = (state_dir / "readings.jsonl").read_bytes()

    desire_events.correct(state_dir, event_id, "issue was closed as done", now)
    desire_events.file_reading(state_dir, event_id, "it landed well", now)
    assert desire_events.retract(state_dir, event_id, "wrong issue", now) is True

    assert (state_dir / "events.jsonl").read_bytes().startswith(events_before)
    assert (state_dir / "readings.jsonl").read_bytes().startswith(readings_before)
    lines = [
        json.loads(line) for line in (state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert lines == [
        {
            "id": event_id,
            "at": now.isoformat(),
            "fact": "issue was closed",
            "source": "monitor",
            "source_ref": "https://x/1",
        },
        {"corrects": event_id, "at": now.isoformat(), "fact": "issue was closed as done"},
        {"retracts": event_id, "at": now.isoformat(), "why": "wrong issue"},
    ]
    assert reading_id.startswith("r-")


def test_events_view_shows_the_latest_correction_and_the_latest_reading(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    first = desire_events.file_event(state_dir, "first fact", "monitor", None, now)
    second, _ = desire_events.file_event_with_reading(state_dir, "second fact", "mine", "ref", now)
    desire_events.correct(state_dir, first, "first, corrected", now)
    desire_events.correct(state_dir, first, "first, corrected again", now)
    desire_events.file_reading(state_dir, first, "early take", now)
    latest = desire_events.file_reading(state_dir, first, "later take", now)

    view = desire_events.events_view(state_dir)

    assert [(event["id"], event["fact"], event["source"], event["source_ref"]) for event in view] == [
        (first, "first, corrected again", "monitor", None),
        (second, "second fact", "agent", "ref"),
    ]
    assert view[0]["reading"] == {"id": latest, "at": now.isoformat(), "text": "later take"}
    assert view[0]["at"] == now.isoformat()
    assert view[1]["reading"]["text"] == "mine"


def test_a_retracted_monitor_event_leaves_the_view_and_stays_a_monitor_ref(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    kept = desire_events.file_event(state_dir, "kept", "monitor", "https://x/kept", now)
    gone = desire_events.file_event(state_dir, "gone", "monitor", "https://x/gone", now)
    mine, _ = desire_events.file_event_with_reading(state_dir, "mine", "felt", "https://x/agent", now)
    with (state_dir / "events.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event("e-00000a", source_ref=7)) + "\n")

    assert desire_events.retract(state_dir, gone, "not mine", now) is True
    before = (state_dir / "events.jsonl").read_bytes()
    assert desire_events.retract(state_dir, gone, "again", now) is False

    assert (state_dir / "events.jsonl").read_bytes() == before
    view = desire_events.events_view(state_dir)
    assert [(item["id"], item["source_ref"]) for item in view] == [
        (kept, "https://x/kept"),
        (mine, "https://x/agent"),
        ("e-00000a", None),
    ]
    assert desire_events.monitor_refs(state_dir) == {"https://x/kept", "https://x/gone"}


def test_a_colliding_id_is_drawn_again(state_dir, at, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    (state_dir / "events.jsonl").write_text(json.dumps(event("e-aaaaaa")) + "\n", encoding="utf-8")
    draws = iter(["aaaaaa", "bbbbbb"])
    monkeypatch.setattr(desire_events.secrets, "token_hex", lambda size: next(draws))

    assert desire_events.file_event(state_dir, "fact", "agent", None, now) == "e-bbbbbb"


def test_the_writers_refuse_what_the_log_cannot_hold(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    event_id = desire_events.file_event(state_dir, "fact", "monitor", None, now)
    retracted = desire_events.file_event(state_dir, "other", "monitor", None, now)
    desire_events.retract(state_dir, retracted, "wrong", now)
    before = (state_dir / "events.jsonl").read_bytes()

    for write in (
        lambda: desire_events.file_event(state_dir, "   ", "agent", None, now),
        lambda: desire_events.file_event(state_dir, "fact", "ghost", None, now),
        lambda: desire_events.file_event_with_reading(state_dir, "fact", "  ", None, now),
        lambda: desire_events.file_reading(state_dir, "e-999999", "text", now),
        lambda: desire_events.file_reading(state_dir, retracted, "text", now),
        lambda: desire_events.file_reading(state_dir, event_id, "\n", now),
        lambda: desire_events.correct(state_dir, "e-999999", "fact", now),
        lambda: desire_events.correct(state_dir, retracted, "fact", now),
        lambda: desire_events.correct(state_dir, event_id, " ", now),
        lambda: desire_events.retract(state_dir, "e-999999", "why", now),
        lambda: desire_events.retract(state_dir, event_id, "", now),
    ):
        with pytest.raises(ValueError):
            write()

    assert (state_dir / "events.jsonl").read_bytes() == before
    assert not (state_dir / "readings.jsonl").exists()


def test_an_agent_event_and_its_reading_are_appended_under_one_lock(state_dir, at, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    real_lock = desire_store.state_lock
    real_append = desire_store.append_jsonl
    depth = [0]
    holds = []

    @contextmanager
    def tracked_lock(directory=None):
        if depth[0] == 0:
            holds.append([])
        depth[0] += 1
        try:
            with real_lock(directory) as locked:
                yield locked
        finally:
            depth[0] -= 1

    def tracked_append(path, value):
        with tracked_lock(path.parent):
            holds[-1].append(path.name)
            real_append(path, value)

    monkeypatch.setattr(desire_store, "state_lock", tracked_lock)
    monkeypatch.setattr(desire_store, "append_jsonl", tracked_append)

    desire_events.file_event_with_reading(state_dir, "fact", "reading", None, now)

    assert ["events.jsonl", "readings.jsonl"] in holds
