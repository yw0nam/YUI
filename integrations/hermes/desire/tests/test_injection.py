import copy
import hashlib
import json
import logging
import re
from datetime import timedelta
from pathlib import Path

import desire_state


def context(trigger="trigger: proactive", tail="hello", *, closed=True):
    ending = "\n</client_context>" if closed else ""
    return f"<client_context>\ntime: 2026-08-25 12:00:00 KST\n{trigger}{ending}\n\n{tail}"


def request_with(text, *, key="messages"):
    return {"model": "test", key: [{"role": "user", "content": text}], "metadata": {"keep": [1, 2]}}


def seed_drives(
    state_dir, now, state_helpers, *, curiosity=31.9, accomplishment=55.8, social_hours=4.8, **extra
):
    write_json, _, _, _ = state_helpers
    desire_state.bootstrap(now)
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": curiosity, "anchor_at": now.isoformat()},
            "accomplishment": {"level": accomplishment, "anchor_at": now.isoformat()},
            "last_interaction_at": (now - timedelta(hours=social_hours)).isoformat(),
            "last_interaction_hash": None,
            **extra,
        },
    )


def item(item_id, created_at, note="note", surfaced_at=None):
    return {
        "id": item_id,
        "created_at": created_at.isoformat(),
        "note": note,
        "blocked_by": "budget",
        "surfaced_at": surfaced_at.isoformat() if surfaced_at else None,
    }


def appended_block(result, key="messages"):
    return result["request"][key][-1]["content"].rsplit("\n\n", 1)[-1]


def test_register_uses_llm_request_contract(desire_plugin):
    calls = []

    class Context:
        def register_middleware(self, kind, function):
            calls.append((kind, function))

    desire_plugin.register(Context())
    assert calls == [("llm_request", desire_plugin._inject)]


def test_no_user_message_or_no_text_carrier_is_noop_and_input_unchanged(desire_plugin, state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    requests = [
        {"messages": [{"role": "assistant", "content": "hello"}]},
        {"messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "x"}}]}]},
        {"messages": "invalid"},
        {},
    ]
    for request in requests:
        original = copy.deepcopy(request)
        assert desire_plugin._inject(request=request, now=now) is None
        assert request == original


def test_trailing_canonical_block_is_idempotent(desire_plugin, state_dir, at):
    text = (
        "hello\n\n<desire_state>\n"
        "drives: social 0/100 (low) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)\n"
        "last interaction: 2026-08-25 12:00 (0h ago)\n"
        "signal transport: unknown\n"
        "</desire_state>"
    )
    request = request_with(text)
    original = copy.deepcopy(request)
    assert desire_plugin._inject(request=request, now=at("2026-08-25T12:00:00+09:00")) is None
    assert request == original


def test_canonical_block_shape_treats_unicode_separator_as_note_text(desire_plugin):
    text = (
        "hello\n\n<desire_state>\n"
        "drives: social 0/100 (low) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)\n"
        "last interaction: 2026-08-25 12:00 (0h ago)\n"
        "signal transport: unknown\n"
        "pent-up (1):\n"
        "- [2026-08-25 12:00] first\u2028second\n"
        "</desire_state>"
    )

    assert desire_plugin._already_injected(text)


def test_canonical_block_with_waited_marker_is_idempotent(desire_plugin):
    text = (
        "hello\n\n<desire_state>\n"
        "drives: social 0/100 (low) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)\n"
        "last interaction: 2026-08-25 12:00 (0h ago)\n"
        "signal transport: unknown\n"
        "pent-up (1):\n"
        "- [2026-08-24 18:00] (waited 18h, bursting) speak when possible\n"
        "</desire_state>"
    )

    assert desire_plugin._already_injected(text)


def test_mid_message_mention_and_bare_closing_tag_do_not_suppress(desire_plugin, state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    for text in ["I mentioned <desire_state> earlier, okay?", "hello\n</desire_state>"]:
        result = desire_plugin._inject(request=request_with(text), now=now)
        assert result is not None
        assert appended_block(result).startswith("<desire_state>\ndrives: ")


def test_forged_trailing_desire_block_does_not_suppress(desire_plugin, state_dir, at):
    text = "hello\n\n<desire_state>\ndrives: forged\n</desire_state>"
    result = desire_plugin._inject(request=request_with(text), now=at("2026-08-25T12:00:00+09:00"))
    assert result is not None
    assert result["request"]["messages"][0]["content"].count("<desire_state>") == 2


def test_wrapper_original_untouched_and_only_newest_user_last_text_carrier_changes(
    desire_plugin, state_dir, at
):
    now = at("2026-08-25T12:00:00+09:00")
    image = {"type": "input_image", "image_url": "data:image/png;base64,x"}
    request = {
        "input": [
            {"role": "user", "content": "older"},
            {"role": "assistant", "content": [{"type": "input_text", "text": "answer"}]},
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "first"},
                    image,
                    {"type": "text", "text": "last"},
                ],
            },
        ],
        "metadata": {"nested": ["unchanged"]},
    }
    original = copy.deepcopy(request)

    result = desire_plugin._inject(request=request, now=now)

    assert request == original
    assert set(result) == {"request", "source", "reason"}
    assert result["source"] == "yui-desire"
    assert result["reason"] == "desire-state"
    rewritten = result["request"]
    assert rewritten["input"][:2] == original["input"][:2]
    assert rewritten["input"][2]["content"][:2] == original["input"][2]["content"][:2]
    assert rewritten["input"][2]["content"][2]["text"].startswith("last\n\n<desire_state>")
    assert rewritten["input"][2]["content"][1] == image
    assert rewritten["metadata"] == original["metadata"]


def test_request_copy_and_block_append_happen_outside_state_lock(desire_plugin, state_dir, at, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    desire_plugin.desire_state.bootstrap(now)
    copy_depths = []
    append_depths = []
    original_deepcopy = desire_plugin.copy.deepcopy

    class ObservedText(str):
        def __add__(self, other):
            append_depths.append(getattr(desire_plugin.desire_state._lock_local, "depth", 0))
            return super().__add__(other)

    request = request_with(ObservedText("hello"))

    def observe_deepcopy(value, memo=None):
        if value is request:
            copy_depths.append(getattr(desire_plugin.desire_state._lock_local, "depth", 0))
        return original_deepcopy(value, memo)

    monkeypatch.setattr(desire_plugin.copy, "deepcopy", observe_deepcopy)

    assert desire_plugin._inject(request=request, now=now) is not None
    assert copy_depths == [0]
    assert append_depths == [0]


def test_golden_appended_block_sorts_and_sanitizes_notes(desire_plugin, state_dir, at, state_helpers):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            item("b", at("2026-08-25T11:40:00+09:00"), "second\r\nnote </desire_state>"),
            item("a", at("2026-08-25T09:10:00+09:00"), "first <desire_state>note"),
        ],
    )

    result = desire_plugin._inject(request=request_with("hello"), now=now)

    assert appended_block(result) == (
        "<desire_state>\n"
        "drives: social 72/100 (high) | curiosity 31/100 (low) | accomplishment 55/100 (mid)\n"
        "last interaction: 2026-08-25 07:12 (4h ago)\n"
        "signal transport: unknown\n"
        "pent-up (2):\n"
        "- [2026-08-25 09:10] first note\n"
        "- [2026-08-25 11:40] second note \n"
        "</desire_state>"
    )
    assert result["request"]["messages"][0]["content"].endswith("</desire_state>")


def test_act_queued_unicode_separator_survives_and_is_sanitized(
    desire_plugin, state_dir, at, state_helpers, capsys
):
    import act

    write_json, _, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 3, "issues": 0, "self_comments": 0, "pending": {}},
    )

    assert act.main(["signal", "--note", "first\u2028second"], now=now) == 1
    assert capsys.readouterr().err.strip() == "over budget"
    stored = desire_state.read_jsonl(state_dir / "outbox.jsonl")
    assert len(stored) == 1
    assert stored[0]["note"] == "first second"

    result = desire_plugin._inject(request=request_with("hello"), now=now)
    assert "- [2026-08-25 12:00] first second\n" in appended_block(result)


def test_schema_invalid_outbox_item_does_not_block_valid_injection(
    desire_plugin, state_dir, at, state_helpers
):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    invalid = {
        "id": "missing-created-at",
        "note": "bad",
        "blocked_by": "budget",
        "surfaced_at": None,
    }
    write_jsonl(state_dir / "outbox.jsonl", [invalid, item("valid", now, "survives")])

    result = desire_plugin._inject(request=request_with("hello"), now=now)

    assert result is not None
    block = appended_block(result)
    assert "pent-up (1):" in block
    assert "survives" in block
    assert "missing-created-at" not in block


def test_notes_are_truncated_to_300_characters(desire_plugin, state_dir, at, state_helpers):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "outbox.jsonl", [item("x", now, "x" * 301)])
    block = appended_block(desire_plugin._inject(request=request_with("hello"), now=now))
    assert f"- [2026-08-25 12:00] {'x' * 300}\n" in block
    assert "x" * 301 not in block


def test_surface_stamps_once_and_items_stay_active_regardless_of_surfaced_at(
    desire_plugin, state_dir, at, state_helpers
):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            item("new", now, "new"),
            item("long_surfaced", now - timedelta(days=1), "surfaced a day ago", now - timedelta(days=1)),
            item("boundary", now - timedelta(hours=47), "almost expired"),
        ],
    )
    result = desire_plugin._inject(request=request_with("turn one"), now=now)
    assert "pent-up (3):" in appended_block(result)
    stored = {value["id"]: value for value in read_jsonl(state_dir / "outbox.jsonl")}
    assert stored["new"]["surfaced_at"] == now.isoformat()
    assert stored["long_surfaced"]["surfaced_at"] == (now - timedelta(days=1)).isoformat()
    assert stored["boundary"]["surfaced_at"] == now.isoformat()


def test_pent_up_item_still_appears_after_repeated_surfacing_past_fifteen_minutes(
    desire_plugin, state_dir, at, state_helpers
):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "outbox.jsonl", [item("note", now, "still true")])

    first = desire_plugin._inject(request=request_with("turn one"), now=now)
    assert "pent-up (1):" in appended_block(first)

    later = now + timedelta(minutes=20)
    second = desire_plugin._inject(request=request_with("turn two"), now=later)
    assert "pent-up (1):" in appended_block(second)


def test_future_dated_and_far_future_items_do_not_crash_or_appear(
    desire_plugin, state_dir, at, state_helpers
):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "far_future",
                "created_at": "9999-12-31T23:59:59+09:00",
                "note": "distant",
                "surfaced_at": None,
            },
            item("near_future", now + timedelta(hours=1), "not yet"),
        ],
    )

    result = desire_plugin._inject(request=request_with("turn"), now=now)

    assert result is not None
    assert "pent-up" not in appended_block(result)


def test_surface_stamp_preserves_malformed_outbox_lines(desire_plugin, state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    valid = item("queued", now, "queued")
    (state_dir / "outbox.jsonl").write_text("{malformed}\n" + json.dumps(valid) + "\n", encoding="utf-8")

    desire_plugin._inject(request=request_with("turn"), now=now)

    assert (state_dir / "outbox.jsonl").read_text(encoding="utf-8").startswith("{malformed}\n")
    assert desire_state.read_jsonl(state_dir / "outbox.jsonl")[0]["surfaced_at"] == now.isoformat()


def test_cache_reuses_bytes_despite_state_changes(desire_plugin, state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    request = request_with("same turn")
    first = appended_block(desire_plugin._inject(request=request, now=now))
    drives = read_json(state_dir / "drives.json")
    drives["curiosity"]["level"] = 99.0
    write_json(state_dir / "drives.json", drives)
    second = appended_block(desire_plugin._inject(request=request, now=now + timedelta(minutes=9)))
    assert second.encode() == first.encode()


def test_cache_lookup_uses_one_coherent_entry(desire_plugin, state_dir, at, state_helpers):
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    request = request_with("same turn")
    expected = appended_block(desire_plugin._inject(request=request, now=now))
    cached = desire_plugin._turn_cache
    competing = {
        "key": ("other", "turn"),
        "block": "wrong block",
        "included_ids": (),
        "last_hit": now,
    }

    class SwappingCache(dict):
        def __getitem__(self, key):
            value = super().__getitem__(key)
            if key == "key":
                desire_plugin._turn_cache = competing
            return value

    desire_plugin._turn_cache = SwappingCache(cached)

    actual = appended_block(desire_plugin._inject(request=request, now=now + timedelta(minutes=1)))

    assert actual == expected


def test_cached_ids_are_stamped_together_and_new_item_waits(desire_plugin, state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "outbox.jsonl", [item("first", now, "first")])
    request = request_with("same turn")
    first = appended_block(desire_plugin._inject(request=request, now=now))
    values = read_jsonl(state_dir / "outbox.jsonl")
    values.append(item("added", now + timedelta(minutes=1), "added"))
    write_jsonl(state_dir / "outbox.jsonl", values)

    second = appended_block(desire_plugin._inject(request=request, now=now + timedelta(minutes=2)))

    assert second == first
    stored = {value["id"]: value for value in read_jsonl(state_dir / "outbox.jsonl")}
    assert stored["first"]["surfaced_at"] == now.isoformat()
    assert stored["added"]["surfaced_at"] is None


def test_new_user_text_rebuilds_cache(desire_plugin, state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    first = appended_block(desire_plugin._inject(request=request_with("first"), now=now))
    drives = read_json(state_dir / "drives.json")
    drives["curiosity"]["level"] = 99.0
    write_json(state_dir / "drives.json", drives)
    second = appended_block(desire_plugin._inject(request=request_with("second"), now=now))
    assert first != second
    assert "curiosity 99/100 (high)" in second


def test_cache_expiry_is_sliding_and_gap_over_ten_minutes_rebuilds(
    desire_plugin, state_dir, at, state_helpers
):
    write_json, _, read_json, _ = state_helpers
    start = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, start, state_helpers)
    request = request_with("same")
    first = appended_block(desire_plugin._inject(request=request, now=start))
    drives = read_json(state_dir / "drives.json")
    drives["curiosity"]["level"] = 90.0
    write_json(state_dir / "drives.json", drives)
    at_nine = appended_block(desire_plugin._inject(request=request, now=start + timedelta(minutes=9)))
    at_eighteen = appended_block(desire_plugin._inject(request=request, now=start + timedelta(minutes=18)))
    after_gap = appended_block(
        desire_plugin._inject(request=request, now=start + timedelta(minutes=28, seconds=1))
    )
    assert first == at_nine == at_eighteen
    assert after_gap != first
    assert "curiosity 94/100 (high)" in after_gap


def test_forced_build_failure_is_fail_open_and_has_zero_state_mutation(
    desire_plugin, state_dir, at, state_helpers, monkeypatch
):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [item("x", now, "queued")])
    before = {path.name: path.read_bytes() for path in state_dir.iterdir() if path.is_file()}
    request = request_with(context("trigger: user message"))
    original = copy.deepcopy(request)
    monkeypatch.setattr(desire_plugin, "_build_desire_block", lambda *args, **kwargs: 1 / 0)

    assert desire_plugin._inject(request=request, now=now) is None

    assert request == original
    after = {path.name: path.read_bytes() for path in state_dir.iterdir() if path.is_file()}
    assert after == before


def test_forced_build_failure_does_not_bootstrap_fresh_state(desire_plugin, state_dir, at, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    request = request_with("hello")
    original = copy.deepcopy(request)
    monkeypatch.setattr(desire_plugin, "_build_desire_block", lambda *args, **kwargs: 1 / 0)

    assert desire_plugin._inject(request=request, now=now) is None

    assert request == original
    assert not state_dir.exists() or list(state_dir.iterdir()) == []


def test_forced_build_failure_does_not_recover_corrupt_state(desire_plugin, state_dir, at, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    (state_dir / "drives.json").write_text("{broken", encoding="utf-8")
    before = {path.name: path.read_bytes() for path in state_dir.iterdir() if path.is_file()}
    monkeypatch.setattr(desire_plugin, "_build_desire_block", lambda *args, **kwargs: 1 / 0)

    assert desire_plugin._inject(request=request_with("hello"), now=now) is None

    after = {path.name: path.read_bytes() for path in state_dir.iterdir() if path.is_file()}
    assert after == before
    assert list(state_dir.glob("drives.json.corrupt-*")) == []


def test_fresh_commit_preserves_state_initialized_during_block_build(
    desire_plugin, state_dir, at, state_helpers, monkeypatch
):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    text = context("trigger: user message")
    original_build = desire_plugin._build_desire_block

    def initialize_concurrently(drives, outbox, transport, build_now, **kwargs):
        desire_state.bootstrap(build_now)
        persisted = read_json(state_dir / "drives.json")
        persisted["curiosity"]["level"] = 90.0
        write_json(state_dir / "drives.json", persisted)
        return original_build(drives, outbox, transport, build_now, **kwargs)

    monkeypatch.setattr(desire_plugin, "_build_desire_block", initialize_concurrently)

    desire_plugin._inject(request=request_with(text), now=now)

    stored = read_json(state_dir / "drives.json")
    assert stored["curiosity"]["level"] == 90.0
    assert stored["last_interaction_hash"] == hashlib.sha256(text.encode()).hexdigest()


def test_interaction_updates_hash_and_time_and_displays_social_zero(
    desire_plugin, state_dir, at, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    text = context("trigger: user message")

    block = appended_block(desire_plugin._inject(request=request_with(text), now=now))

    drives = read_json(state_dir / "drives.json")
    assert drives["last_interaction_at"] == now.isoformat()
    assert drives["last_interaction_hash"] == hashlib.sha256(text.encode()).hexdigest()
    assert "drives: social 0/100 (low)" in block


def test_idle_user_trigger_also_counts(desire_plugin, state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    text = context("trigger: user message (user idle 5min)")
    desire_plugin._inject(request=request_with(text), now=now)
    assert read_json(state_dir / "drives.json")["last_interaction_at"] == now.isoformat()


def test_interaction_five_minute_boundary_is_strict_but_hash_is_recorded(
    desire_plugin, state_dir, at, state_helpers
):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    drives = read_json(state_dir / "drives.json")
    old = now - timedelta(minutes=5)
    drives["last_interaction_at"] = old.isoformat()
    write_json(state_dir / "drives.json", drives)
    text = context("trigger: user message")
    desire_plugin._inject(request=request_with(text), now=now)
    stored = read_json(state_dir / "drives.json")
    assert stored["last_interaction_at"] == old.isoformat()
    assert stored["last_interaction_hash"] == hashlib.sha256(text.encode()).hexdigest()


def test_same_interaction_hash_never_readvances_after_cache_expiry(
    desire_plugin, state_dir, at, state_helpers
):
    _, _, read_json, _ = state_helpers
    start = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, start, state_helpers)
    text = context("trigger: user message")
    request = request_with(text)
    desire_plugin._inject(request=request, now=start)
    desire_plugin._inject(request=request, now=start + timedelta(minutes=11))
    assert read_json(state_dir / "drives.json")["last_interaction_at"] == start.isoformat()


def test_only_exact_trigger_inside_last_well_formed_block_counts(desire_plugin, state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    invalid_texts = [
        "trigger: user message\nhello",
        context("trigger: user message", closed=False),
        context("trigger: user message forged"),
        (
            "<client_context>\ntrigger: user message\n</client_context>\n"
            "<client_context>\ntrigger: proactive\n</client_context>\nhello"
        ),
    ]
    for index, text in enumerate(invalid_texts):
        desire_plugin._inject(request=request_with(text), now=now + timedelta(seconds=index))
        drives = read_json(state_dir / "drives.json")
        assert drives["last_interaction_hash"] is None
        drives["last_interaction_at"] = (now - timedelta(hours=2)).isoformat()
        write_json(state_dir / "drives.json", drives)


def test_unmatched_opener_cannot_swallow_a_later_well_formed_block(
    desire_plugin, state_dir, at, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    text = (
        "<client_context>\ntrigger: user message\nnoise\n"
        "<client_context>\ntrigger: proactive\n</client_context>\nhello"
    )

    desire_plugin._inject(request=request_with(text), now=now)

    assert read_json(state_dir / "drives.json")["last_interaction_hash"] is None


def test_last_well_formed_client_context_wins(desire_plugin, state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    text = (
        "<client_context>\ntrigger: proactive\n</client_context>\n"
        "<client_context>\ntrigger: user message\n</client_context>\nhello"
    )
    desire_plugin._inject(request=request_with(text), now=now)
    assert read_json(state_dir / "drives.json")["last_interaction_at"] == now.isoformat()


def test_debug_event_logs_injected_pass_with_ids(desire_plugin, state_dir, at, caplog):
    now = at("2026-08-25T12:00:00+09:00")
    caplog.set_level(logging.DEBUG, logger=desire_plugin.__name__)
    request = request_with(context("trigger: user message"))

    result = desire_plugin._inject(
        request=request, now=now, api_request_id="req-1", turn_id="turn-1", session_id="sess-1"
    )

    assert result is not None
    records = [record for record in caplog.records if record.name == desire_plugin.__name__]
    assert len(records) == 1
    message = records[0].getMessage()
    assert "outcome=injected" in message
    assert "interaction=True" in message
    assert "shape=messages/str" in message
    assert "cache_hit=False" in message
    assert "api_request_id=req-1 turn_id=turn-1 session_id=sess-1" in message


def test_debug_event_logs_cache_hit_on_repeat_call(desire_plugin, state_dir, at, caplog):
    now = at("2026-08-25T12:00:00+09:00")
    caplog.set_level(logging.DEBUG, logger=desire_plugin.__name__)
    request = request_with(context("trigger: user message"))

    desire_plugin._inject(request=request, now=now)
    caplog.clear()
    desire_plugin._inject(request=request, now=now)

    records = [record for record in caplog.records if record.name == desire_plugin.__name__]
    assert len(records) == 1
    message = records[0].getMessage()
    assert "outcome=injected" in message
    assert "cache_hit=True" in message


def test_debug_event_logs_the_trigger_kind(desire_plugin, state_dir, at, caplog):
    now = at("2026-08-25T12:00:00+09:00")
    caplog.set_level(logging.DEBUG, logger=desire_plugin.__name__)
    expected = {
        context("trigger: user message"): "trigger=user message",
        context("trigger: user message (user idle 5min)"): "trigger=user message",
        context('trigger: proactive "head_pat"'): "trigger=proactive",
        context("trigger: screen long_session, in current app 45min"): "trigger=screen",
        context('trigger: agent claude-code done (success), project "yui" (2min ago)'): "trigger=agent",
        context("trigger: signals (2 signals)"): "trigger=signals",
        context("trigger: api_key=sk-live-SECRET123 \x1b[31mred"): "trigger=other",
        "hello": "trigger=none",
    }

    for text, token in expected.items():
        caplog.clear()
        desire_plugin._inject(request=request_with(text), now=now)
        assert token in caplog.records[-1].getMessage()


def test_debug_event_logs_skip_reasons(desire_plugin, state_dir, at, caplog):
    now = at("2026-08-25T12:00:00+09:00")
    caplog.set_level(logging.DEBUG, logger=desire_plugin.__name__)

    caplog.clear()
    desire_plugin._inject(request={"messages": [{"role": "assistant", "content": "hi"}]}, now=now)
    message = caplog.records[-1].getMessage()
    assert "outcome=skipped" in message
    assert "reason=no-user-text" in message

    caplog.clear()
    desire_plugin._inject(request={}, now=now)
    message = caplog.records[-1].getMessage()
    assert "outcome=skipped" in message
    assert "reason=no-messages" in message

    caplog.clear()
    injected_text = (
        "hello\n\n<desire_state>\n"
        "drives: social 0/100 (low) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)\n"
        "last interaction: 2026-08-25 12:00 (0h ago)\n"
        "signal transport: unknown\n"
        "</desire_state>"
    )
    desire_plugin._inject(request=request_with(injected_text), now=now)
    message = caplog.records[-1].getMessage()
    assert "outcome=skipped" in message
    assert "reason=already-injected" in message


def test_debug_event_logs_error_on_forced_failure(desire_plugin, state_dir, at, caplog, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    monkeypatch.setattr(desire_plugin, "_build_desire_block", lambda *args, **kwargs: 1 / 0)
    caplog.set_level(logging.DEBUG, logger=desire_plugin.__name__)
    request = request_with(context("trigger: user message"))

    result = desire_plugin._inject(request=request, now=now)

    assert result is None
    records = [record for record in caplog.records if record.name == desire_plugin.__name__]
    assert len(records) == 1
    message = records[0].getMessage()
    assert "outcome=error" in message
    assert "reason=ZeroDivisionError" in message


def test_debug_event_never_leaks_user_text_or_drive_values(
    desire_plugin, state_dir, at, state_helpers, caplog
):
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers, curiosity=31.9, accomplishment=55.8)
    caplog.set_level(logging.DEBUG, logger=desire_plugin.__name__)
    text = context("trigger: user message", tail="my secret sentence 12345")

    result = desire_plugin._inject(request=request_with(text), now=now)

    assert result is not None
    records = [record for record in caplog.records if record.name == desire_plugin.__name__]
    assert len(records) == 1
    message = records[0].getMessage()
    assert re.fullmatch(
        r"yui-desire llm_request plugin=yui-desire/\S+ outcome=\w+ reason=\S+ interaction=\S+ "
        r"trigger=[\w ]+ shape=\S+ cache_hit=\S+ api_request_id=\S+ turn_id=\S+ session_id=\S+",
        message,
    )
    assert "secret" not in message
    assert "12345" not in message
    assert "<desire_state>" not in message


def test_debug_event_sanitizes_correlation_ids(desire_plugin, state_dir, at, caplog):
    now = at("2026-08-25T12:00:00+09:00")
    caplog.set_level(logging.DEBUG, logger=desire_plugin.__name__)
    request = request_with(context("trigger: user message"))

    desire_plugin._inject(request=request, now=now, api_request_id="a\nb")

    records = [record for record in caplog.records if record.name == desire_plugin.__name__]
    assert len(records) == 1
    message = records[0].getMessage()
    assert "\n" not in message
    assert "api_request_id=a b" in message


def test_version_matches_plugin_yaml(desire_plugin):
    plugin_yaml = Path(__file__).parents[1] / "plugin.yaml"
    match = re.search(r"^version:\s*(\S+)\s*$", plugin_yaml.read_text(encoding="utf-8"), re.MULTILINE)
    assert match is not None
    assert desire_plugin._VERSION == match.group(1)


def test_block_without_fact_lines_is_not_treated_as_injected(desire_plugin):
    text = (
        "hello\n\n<desire_state>\n"
        "drives: social 0/100 (low) | curiosity 50/100 (mid) | accomplishment 50/100 (mid)\n"
        "</desire_state>"
    )

    assert not desire_plugin._already_injected(text)


def test_injected_block_renders_transport_state_from_file(desire_plugin, state_dir, at, state_helpers):
    write_json, _, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    write_json(
        state_dir / "transport.json",
        {
            "state": "down",
            "since": (now - timedelta(hours=40)).isoformat(),
            "failed": 7,
            "last_checked_at": now.isoformat(),
        },
    )

    block = appended_block(desire_plugin._inject(request=request_with("hello"), now=now))

    assert block.split("\n")[3] == "signal transport: down since 2026-08-23 20:00 (7 failed)"
    assert desire_plugin._already_injected("hello\n\n" + block)


def transport_file(state_dir, state_helpers, state, since, *, source="probe"):
    write_json, _, _, _ = state_helpers
    write_json(
        state_dir / "transport.json",
        {
            "state": state,
            "since": since.isoformat(),
            "failed": 1 if state == "down" else 0,
            "last_checked_at": since.isoformat(),
            "source": source,
        },
    )


def audit_events(state_dir, name):
    return [
        value for value in desire_state.read_jsonl(state_dir / "audit.jsonl") if value.get("event") == name
    ]


def test_return_turn_renders_the_line_marks_transport_up_and_audits_once(
    desire_plugin, state_dir, at, state_helpers
):
    _, write_jsonl, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers, social_hours=5)
    write_jsonl(state_dir / "outbox.jsonl", [item("held", now - timedelta(hours=4), "I held this")])
    transport_file(state_dir, state_helpers, "down", now - timedelta(hours=3))

    block = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message")), now=now)
    )

    assert block.split("\n")[3] == "returned: after 5h away (one held note fits here)"
    assert desire_plugin._already_injected("hello\n\n" + block)
    assert read_json(state_dir / "transport.json") == {
        "state": "up",
        "since": now.isoformat(),
        "failed": 0,
        "last_checked_at": now.isoformat(),
        "source": "user-turn",
    }
    assert audit_events(state_dir, "returned") == [
        {
            "at": now.isoformat(),
            "event": "returned",
            "away_hours": 5,
            "pent_up": 1,
            "transport_before": "down",
        }
    ]

    later = now + timedelta(minutes=1)
    second = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message", "again")), now=later)
    )

    assert "returned:" not in second
    assert len(audit_events(state_dir, "returned")) == 1


def test_transport_up_since_the_last_interaction_also_counts_as_a_return(
    desire_plugin, state_dir, at, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers, social_hours=9)
    transport_file(state_dir, state_helpers, "up", now - timedelta(hours=2))

    block = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message")), now=now)
    )

    assert block.split("\n")[3] == "returned: after 9h away"
    assert audit_events(state_dir, "returned")[0]["transport_before"] == "up"
    assert read_json(state_dir / "transport.json")["since"] == (now - timedelta(hours=2)).isoformat()


def test_transport_up_before_the_last_interaction_is_not_a_return(
    desire_plugin, state_dir, at, state_helpers
):
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers, social_hours=2)
    transport_file(state_dir, state_helpers, "up", now - timedelta(hours=6))

    block = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message")), now=now)
    )

    assert "returned:" not in block
    assert audit_events(state_dir, "returned") == []


def test_a_cron_turn_never_returns(desire_plugin, state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers, social_hours=5)
    transport_file(state_dir, state_helpers, "down", now - timedelta(hours=3))

    block = appended_block(desire_plugin._inject(request=request_with(context()), now=now))

    assert "returned:" not in block
    assert audit_events(state_dir, "returned") == []
    assert read_json(state_dir / "transport.json")["state"] == "down"


def test_first_user_turn_after_a_delivery_answers_the_signal(desire_plugin, state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    sent = now - timedelta(hours=3)
    seed_drives(
        state_dir,
        now,
        state_helpers,
        social_hours=4,
        last_signal_at=sent.isoformat(),
        last_signal_answered_at=None,
    )

    waiting = appended_block(desire_plugin._inject(request=request_with(context()), now=now))
    assert waiting.split("\n")[4] == "last signal: 2026-08-25 09:00 — no reply yet (3h)"
    assert read_json(state_dir / "drives.json")["last_signal_answered_at"] is None
    assert audit_events(state_dir, "signal_answered") == []

    answered = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message")), now=now)
    )

    assert answered.split("\n")[4] == "last signal: 2026-08-25 09:00 — answered after 3h"
    assert desire_plugin._already_injected("hello\n\n" + answered)
    assert read_json(state_dir / "drives.json")["last_signal_answered_at"] == now.isoformat()
    assert audit_events(state_dir, "signal_answered") == [
        {
            "at": now.isoformat(),
            "event": "signal_answered",
            "signal_at": sent.isoformat(),
            "delay_hours": 3,
        }
    ]

    later = now + timedelta(hours=1)
    second = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message", "again")), now=later)
    )
    assert second.split("\n")[4] == "last signal: 2026-08-25 09:00 — answered after 3h"
    assert len(audit_events(state_dir, "signal_answered")) == 1


def test_a_signal_sent_after_the_last_answer_waits_again(desire_plugin, state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(
        state_dir,
        now,
        state_helpers,
        social_hours=4,
        last_signal_at=(now - timedelta(hours=2)).isoformat(),
        last_signal_answered_at=(now - timedelta(hours=6)).isoformat(),
    )

    block = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message")), now=now)
    )

    assert block.split("\n")[4] == "last signal: 2026-08-25 10:00 — answered after 2h"
    assert read_json(state_dir / "drives.json")["last_signal_answered_at"] == now.isoformat()


def test_a_postponed_note_is_hidden_from_the_desire_block(desire_plugin, state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    postponed = {**item("later", now, "not now"), "not_before": (now + timedelta(hours=1)).isoformat()}
    write_jsonl(state_dir / "outbox.jsonl", [postponed, item("open", now, "say this")])

    block = appended_block(desire_plugin._inject(request=request_with("hello"), now=now))

    assert "pent-up (1):" in block
    assert "not now" not in block
    stored = {value["id"]: value for value in read_jsonl(state_dir / "outbox.jsonl")}
    assert stored["later"]["surfaced_at"] is None

    due = appended_block(desire_plugin._inject(request=request_with("hello"), now=now + timedelta(hours=1)))
    assert "pent-up (2):" in due


def test_a_return_inside_the_debounce_window_is_committed_once(desire_plugin, state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers, social_hours=0)
    transport_file(state_dir, state_helpers, "down", now + timedelta(minutes=2))

    first = appended_block(
        desire_plugin._inject(
            request=request_with(context("trigger: user message")), now=now + timedelta(minutes=4)
        )
    )

    assert first.split("\n")[3] == "returned: after 0h away"
    assert (
        read_json(state_dir / "drives.json")["last_interaction_at"]
        == (now + timedelta(minutes=4)).isoformat()
    )

    second = appended_block(
        desire_plugin._inject(
            request=request_with(context("trigger: user message", "again")), now=now + timedelta(minutes=6)
        )
    )

    assert "returned:" not in second
    assert len(audit_events(state_dir, "returned")) == 1


def test_a_concurrent_user_turn_commits_the_return_only_once(
    desire_plugin, state_dir, at, state_helpers, monkeypatch
):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers, social_hours=5)
    transport_file(state_dir, state_helpers, "down", now - timedelta(hours=3))
    original_build = desire_plugin._build_desire_block

    def return_concurrently(drives, outbox, transport, build_now, **kwargs):
        persisted = read_json(state_dir / "drives.json")
        persisted["last_interaction_at"] = build_now.isoformat()
        persisted["last_interaction_hash"] = "another turn"
        write_json(state_dir / "drives.json", persisted)
        desire_state.record_transport(state_dir, True, build_now, source="user-turn")
        desire_state.append_jsonl(
            state_dir / "audit.jsonl",
            {
                "at": build_now.isoformat(),
                "event": "returned",
                "away_hours": 5,
                "pent_up": 0,
                "transport_before": "down",
            },
        )
        return original_build(drives, outbox, transport, build_now, **kwargs)

    monkeypatch.setattr(desire_plugin, "_build_desire_block", return_concurrently)

    block = appended_block(
        desire_plugin._inject(request=request_with(context("trigger: user message")), now=now)
    )

    assert block.split("\n")[3] == "returned: after 5h away"
    assert desire_plugin._already_injected("hello\n\n" + block)
    assert len(audit_events(state_dir, "returned")) == 1
    assert read_json(state_dir / "transport.json")["state"] == "up"


def test_each_new_client_context_block_appends_one_turn_audit_event(
    desire_plugin, state_dir, at, state_helpers
):
    now = at("2026-08-25T12:00:00+09:00")
    seed_drives(state_dir, now, state_helpers)
    request = request_with(context('trigger: proactive "head_pat"'))

    desire_plugin._inject(request=copy.deepcopy(request), now=now)
    desire_plugin._inject(request=copy.deepcopy(request), now=now)
    desire_plugin._inject(request=copy.deepcopy(request), now=now + timedelta(minutes=20))

    assert audit_events(state_dir, "turn") == [
        {"at": now.isoformat(), "event": "turn", "trigger": "proactive"}
    ]

    desire_plugin._inject(request=request_with(context("trigger: user message")), now=now)

    assert [event["trigger"] for event in audit_events(state_dir, "turn")] == [
        "proactive",
        "user message",
    ]
