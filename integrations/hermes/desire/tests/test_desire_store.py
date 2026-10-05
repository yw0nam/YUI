import json
from datetime import timedelta

import desire_store


def test_malformed_jsonl_is_skipped_and_unterminated_tail_is_separated(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    path = state_dir / "outbox.jsonl"
    path.write_bytes(b'{"id":"good"}\n{malformed tail')
    assert desire_store.read_jsonl(path) == [{"id": "good"}]

    desire_store.append_jsonl(path, {"id": "new", "created_at": now.isoformat()})

    assert path.read_bytes().endswith(b'{"id": "new", "created_at": "2026-08-25T12:00:00+09:00"}\n')
    assert desire_store.read_jsonl(path)[-1]["id"] == "new"
    assert path.read_text(encoding="utf-8").splitlines()[-1] == json.dumps(
        {"id": "new", "created_at": now.isoformat()}
    )


def test_public_jsonl_reader_reports_dropped_lines(state_dir):
    path = state_dir / "outbox.jsonl"
    path.write_text('{"id":"good"}\n{broken}\n', encoding="utf-8")

    values, dropped = desire_store.read_jsonl_with_dropped(path)

    assert values == [{"id": "good"}]
    assert dropped == 1


def test_record_transport_tracks_since_and_consecutive_failures(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    first = at("2026-08-25T12:00:00+09:00")
    later = first + timedelta(hours=1)

    assert desire_store.read_transport(state_dir) is None
    desire_store.record_transport(state_dir, False, first)
    desire_store.record_transport(state_dir, False, later)
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": first.isoformat(),
        "failed": 2,
        "last_checked_at": later.isoformat(),
        "source": "probe",
    }
    desire_store.record_transport(state_dir, True, later)
    assert desire_store.read_transport(state_dir) == {
        "state": "up",
        "since": later.isoformat(),
        "failed": 0,
        "last_checked_at": later.isoformat(),
        "source": "probe",
    }
    (state_dir / "transport.json").write_text("{bad", encoding="utf-8")
    assert desire_store.read_transport(state_dir) is None


def test_read_transport_rejects_json_valid_non_object(state_dir):
    (state_dir / "transport.json").write_text("[]", encoding="utf-8")
    assert desire_store.read_transport(state_dir) is None
    (state_dir / "transport.json").write_text('"garbage"', encoding="utf-8")
    assert desire_store.read_transport(state_dir) is None


def test_record_transport_quarantines_corrupt_file(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    (state_dir / "transport.json").write_text("[]", encoding="utf-8")

    value = desire_store.record_transport(state_dir, False, now)

    assert value["state"] == "down"
    assert read_json(state_dir / "transport.json") == value
    assert list(state_dir.glob("transport.json.corrupt-*"))
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "state_corrupt_recovered",
        "file": "transport.json",
    }


def test_record_transport_skips_probe_older_than_last_check(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    newer = at("2026-08-25T12:00:00+09:00")
    older = newer - timedelta(minutes=5)

    recorded = desire_store.record_transport(state_dir, True, newer)
    assert desire_store.record_transport(state_dir, False, older) == recorded
    assert read_json(state_dir / "transport.json") == recorded


def test_record_transport_stores_its_source_and_read_tolerates_an_older_file(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    desire_store.record_transport(state_dir, False, now)
    assert read_json(state_dir / "transport.json")["source"] == "probe"

    later = now + timedelta(hours=1)
    assert desire_store.record_transport(state_dir, True, later, source="user-turn")["source"] == "user-turn"
    assert read_json(state_dir / "transport.json")["source"] == "user-turn"

    write_json(
        state_dir / "transport.json",
        {"state": "up", "since": now.isoformat(), "failed": 0, "last_checked_at": now.isoformat()},
    )
    assert desire_store.read_transport(state_dir) == {
        "state": "up",
        "since": now.isoformat(),
        "failed": 0,
        "last_checked_at": now.isoformat(),
    }


def test_read_artefacts_reports_absent_state_and_normalizes_a_partial_record(state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    assert desire_store.read_artefacts(state_dir) is None

    write_json(
        state_dir / "artefacts.json",
        {
            "seen": {"pr": ["u"]},
            "unreported": ["bad", {"kind": "pr"}],
            "skill_first_seen": {"a": 1, "b": "t"},
        },
    )
    record = desire_store.read_artefacts(state_dir)
    assert record["seen"] == {"pr": ["u"], "issue": [], "skill": []}
    assert record["skill_first_seen"] == {"b": "t"}
    assert record["bootstrapped"] == []
    assert record["shipped"] == []
    assert record["learned"] == []
    assert record["unreported"] == [{"kind": "pr"}]

    write_json(state_dir / "artefacts.json", ["not an object"])
    assert desire_store.read_artefacts(state_dir) is None

    assert desire_store.default_artefacts(now) == {
        "bootstrapped_at": now.isoformat(),
        "bootstrapped": [],
        "seen": {"pr": [], "issue": [], "skill": []},
        "skill_first_seen": {},
        "shipped": [],
        "learned": [],
        "unreported": [],
    }
