import json
from datetime import timedelta

import pytest

import desire_events
import desire_judgments
import desire_render
import desire_state

SEED = [
    "closeness",
    "trust",
    "doubt",
    "longing",
    "ease",
    "expectation",
    "hope",
    "curiosity",
    "absorption",
    "traction",
    "pride",
    "sense of choosing",
    "surprise",
    "amusement",
    "loneliness",
    "hurt",
    "disappointment",
    "frustration",
    "wavering",
    "tiredness",
    "wariness",
    "anger",
    "jealousy",
    "resentment",
    "contempt",
    "shame",
]


@pytest.fixture
def now(at):
    return at("2026-10-08T12:00:00+09:00")


@pytest.fixture
def seeded(state_dir, now):
    desire_state.bootstrap(now)
    return state_dir


def judgment(name, toward, level, at="2026-10-01T09:00:00+09:00", events=(), why=None):
    return {"at": at, "name": name, "toward": toward, "level": level, "events": list(events), "why": why}


def write_judgments(state_dir, lines):
    path = state_dir / "judgments.jsonl"
    path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")


def toward_lines(state_dir, now):
    block = desire_render.serialize_desire_block(
        [], now, last_interaction_at=now.isoformat(), judgments=desire_judgments.present(state_dir)
    )
    return [line for line in block.split("\n") if line.startswith("toward ")]


def test_a_fresh_registry_holds_the_26_seed_names_in_order(seeded, state_helpers):
    _, _, read_json, _ = state_helpers

    assert read_json(seeded / "feelings.json") == {"names": SEED}
    assert desire_judgments.registry(seeded) == SEED


def test_an_existing_registry_with_other_names_is_kept(state_dir, now):
    path = state_dir / "feelings.json"
    path.write_text('{"names": ["warmth", "closeness"]}', encoding="utf-8")

    desire_state.bootstrap(now)

    assert path.read_text(encoding="utf-8") == '{"names": ["warmth", "closeness"]}'
    assert desire_judgments.registry(state_dir) == ["warmth", "closeness"]
    desire_judgments.judge(state_dir, "warmth", "user", "some", [], None, now)
    with pytest.raises(ValueError):
        desire_judgments.judge(state_dir, "trust", "user", "some", [], None, now)


def test_a_registry_file_with_an_extra_key_is_left_byte_identical(state_dir, now):
    path = state_dir / "feelings.json"
    path.write_text('{"names": ["warmth"], "note": "mine"}', encoding="utf-8")

    desire_state.bootstrap(now)

    assert path.read_text(encoding="utf-8") == '{"names": ["warmth"], "note": "mine"}'
    assert desire_judgments.registry(state_dir) == ["warmth"]


def test_an_invalid_registry_is_quarantined_and_rebuilt(state_dir, now, state_helpers):
    _, _, read_json, _ = state_helpers
    (state_dir / "feelings.json").write_text('{"names": ["a", "a", ""]}', encoding="utf-8")

    desire_state.bootstrap(now)

    assert read_json(state_dir / "feelings.json") == {"names": SEED}
    assert len(list(state_dir.glob("feelings.json.corrupt-*"))) == 1


def test_judge_accepts_every_level_word_and_a_judgment_without_events(seeded, now):
    for name, level in zip(("closeness", "trust", "sense of choosing", "hope"), desire_judgments.LEVELS):
        desire_judgments.judge(seeded, f" {name} ", "user", level, [], None, now)

    present = desire_judgments.present(seeded)

    assert {pair: value["level"] for pair, value in present.items()} == {
        ("closeness", "user"): "faint",
        ("trust", "user"): "some",
        ("sense of choosing", "user"): "strong",
        ("hope", "user"): "very strong",
    }
    assert present[("hope", "user")] == {
        "level": "very strong",
        "at": now.isoformat(),
        "events": [],
        "why": None,
    }


def test_an_unknown_name_is_rejected_with_the_registry(seeded, now):
    with pytest.raises(ValueError) as error:
        desire_judgments.judge(seeded, "warmth", "user", "some", [], None, now)

    assert "known names:\n" + "\n".join(SEED) in str(error.value)
    assert not (seeded / "judgments.jsonl").exists()


@pytest.mark.parametrize(
    ("toward", "level", "events", "error"),
    [
        ("user", "3", [], ValueError),
        ("user", "Strong", [], ValueError),
        ("others", "some", [], ValueError),
        ("user", "some", ["e-999999"], desire_events.UnknownEventError),
        ("user", None, ["e-999999"], ValueError),
    ],
)
def test_a_bad_level_toward_event_or_put_down_with_events_is_rejected(
    seeded, now, toward, level, events, error
):
    desire_judgments.judge(seeded, "trust", "user", "some", [], None, now)
    before = (seeded / "judgments.jsonl").read_bytes()

    with pytest.raises(error):
        desire_judgments.judge(seeded, "trust", toward, level, events, None, now)

    assert (seeded / "judgments.jsonl").read_bytes() == before


def test_a_retracted_event_is_rejected(seeded, now):
    event_id = desire_events.file_event(seeded, "issue was closed", "monitor", "url", now)
    desire_events.retract(seeded, event_id, "not mine", now)

    with pytest.raises(desire_events.RetractedEventError):
        desire_judgments.judge(seeded, "trust", "user", "some", [event_id], None, now)

    assert not (seeded / "judgments.jsonl").exists()


def test_the_latest_line_in_file_order_is_the_present_state_and_a_put_down_drops_only_its_pair(seeded, now):
    write_judgments(
        seeded,
        [
            judgment("closeness", "user", "strong", at="2026-10-05T09:00:00+09:00"),
            judgment("closeness", "self", "some"),
            judgment("closeness", "user", "faint", at="2026-09-01T09:00:00+09:00", why="later in the file"),
        ],
    )
    before = (seeded / "judgments.jsonl").read_bytes()

    desire_judgments.judge(seeded, "closeness", "self", None, [], " over ", now)

    assert desire_judgments.present(seeded) == {
        ("closeness", "user"): {
            "level": "faint",
            "at": "2026-09-01T09:00:00+09:00",
            "events": [],
            "why": "later in the file",
        }
    }
    after = (seeded / "judgments.jsonl").read_bytes()
    assert after.startswith(before)
    assert json.loads(after[len(before) :]) == {
        "at": now.isoformat(),
        "name": "closeness",
        "toward": "self",
        "level": None,
        "events": [],
        "why": "over",
    }


def test_judge_leaves_every_other_state_file_byte_identical(seeded, now):
    event_id = desire_events.file_event_with_reading(seeded, "she said hi", "glad", None, now)[0]
    desire_judgments.write_how(seeded, "steady")
    before = {path.name: path.read_bytes() for path in seeded.iterdir() if path.is_file()}

    desire_judgments.judge(seeded, "ease", "user", "some", [event_id], "because", now)

    after = {path.name: path.read_bytes() for path in seeded.iterdir() if path.is_file()}
    assert after.pop("judgments.jsonl")
    assert after == before


def test_a_name_that_left_the_registry_can_still_be_put_down(seeded, now):
    write_judgments(seeded, [judgment("warmth", "world", "some")])

    desire_judgments.judge(seeded, "warmth", "world", None, [], None, now)

    assert desire_judgments.present(seeded) == {}


def test_a_put_down_of_a_pair_never_judged_is_rejected(seeded, now):
    desire_judgments.judge(seeded, "trust", "user", "some", [], None, now)

    with pytest.raises(ValueError, match="no judgment to put down"):
        desire_judgments.judge(seeded, "trust", "self", None, [], None, now)


def test_grounds_are_the_linked_events_with_their_latest_correction(seeded, now):
    first = desire_events.file_event(seeded, "issue was closd", "monitor", "a", now)
    unlinked = desire_events.file_event(seeded, "unlinked", "monitor", "b", now)
    third = desire_events.file_event(seeded, "pull request was merged", "monitor", "c", now)
    desire_events.correct(seeded, first, "issue was closed", now)
    desire_judgments.judge(seeded, "pride", "self", "some", [third, first], None, now)

    grounds = desire_judgments.grounds(seeded, "pride", "self")

    assert [(event["id"], event["fact"]) for event in grounds] == [
        (first, "issue was closed"),
        (third, "pull request was merged"),
    ]
    assert unlinked not in {event["id"] for event in grounds}
    assert desire_judgments.grounds(seeded, "pride", "user") == []


def test_a_judgment_whose_event_is_retracted_later_still_renders(seeded, now):
    event_id = desire_events.file_event(seeded, "issue was closed", "monitor", "a", now)
    desire_judgments.judge(seeded, "pride", "self", "strong", [event_id], None, now)
    desire_events.retract(seeded, event_id, "not mine", now)

    assert toward_lines(seeded, now) == ["toward self: pride strong (10-08)"]
    assert desire_judgments.grounds(seeded, "pride", "self") == []


def test_malformed_lines_are_skipped(seeded):
    valid = judgment("trust", "user", "some", events=["e-000001"], why="kept")
    lines = [
        valid,
        judgment("trust", "user", None, events=["e-000001"]),
        judgment("trust", "user", "faint", at="not a time"),
        judgment("trust", "user", "faint", at="2026-10-01T09:00:00"),
        judgment("", "user", "faint"),
        judgment("trust", "others", "faint"),
        judgment("trust", "user", 3),
        {**judgment("trust", "user", "faint"), "events": "e-000001"},
        judgment("trust", "user", "faint", events=[1]),
        judgment("trust", "user", "faint", why=5),
        {key: value for key, value in judgment("trust", "user", "faint").items() if key != "events"},
    ]
    write_judgments(seeded, lines)
    with (seeded / "judgments.jsonl").open("a", encoding="utf-8") as stream:
        stream.write("{not json\n[1, 2]\n")

    assert desire_judgments.present(seeded) == {
        ("trust", "user"): {key: valid[key] for key in ("level", "at", "events", "why")}
    }


def test_an_empty_why_is_stored_as_null(seeded, now, state_helpers):
    _, _, _, read_jsonl = state_helpers

    desire_judgments.judge(seeded, "trust", "user", "some", [], "   ", now)

    assert read_jsonl(seeded / "judgments.jsonl")[0]["why"] is None


def test_the_toward_lines_do_not_change_with_the_clock(seeded, now):
    write_judgments(
        seeded,
        [
            judgment("trust", "user", "some", at="2026-10-01T09:00:00+09:00"),
            judgment("closeness", "user", "strong", at="2026-09-19T16:00:00+00:00"),
            judgment("tiredness", "self", "some", at="2026-10-08T09:00:00+09:00"),
        ],
    )

    today = toward_lines(seeded, now)

    assert today == toward_lines(seeded, now + timedelta(days=90))
    assert today == [
        "toward user: closeness strong (09-20) | trust some (10-01)",
        "toward self: tiredness some (10-08)",
    ]


def test_read_how_of_an_absent_file_is_empty(state_dir):
    assert desire_judgments.read_how(state_dir) == ""


def test_write_how_strips_then_allows_exactly_500_and_refuses_501(state_dir):
    desire_judgments.write_how(state_dir, "  \n" + "x" * 500 + "\n")

    assert desire_judgments.read_how(state_dir) == "x" * 500
    with pytest.raises(ValueError, match="501"):
        desire_judgments.write_how(state_dir, " " + "y" * 501)
    assert (state_dir / "how.md").read_text(encoding="utf-8") == "x" * 500
