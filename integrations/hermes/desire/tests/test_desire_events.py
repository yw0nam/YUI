import json

import desire_events


def event(event_id, at="2026-08-25T12:00:00+09:00", fact="fact", source="monitor", source_ref=None):
    return {"id": event_id, "at": at, "fact": fact, "source": source, "source_ref": source_ref}


def unread(state_dir, lines):
    (state_dir / "events.jsonl").write_text(
        "".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8"
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
        {"id": "r-000001", "event_id": "e-000003", "at": "2026-08-25T13:00:00+09:00", "text": "mine"},
    ]

    assert unread(state_dir, lines) == ["e-000001"]


def test_a_retraction_or_reading_naming_an_unknown_event_is_ignored(state_dir):
    lines = [
        event("e-000001"),
        {"retracts": "e-000009", "at": "2026-08-25T13:00:00+09:00", "why": "wrong"},
        {"id": "r-000001", "event_id": "e-000009", "at": "2026-08-25T13:00:00+09:00", "text": "mine"},
    ]

    assert unread(state_dir, lines) == ["e-000001"]


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
