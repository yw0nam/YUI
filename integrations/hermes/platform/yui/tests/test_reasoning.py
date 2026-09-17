"""The backend's reasoning: the live stream hook."""

from __future__ import annotations

import pytest
from gateway_stub import STUB_ENV
from yui import reasoning

CHAT = "yui-3f9a2c1d"


@pytest.fixture(autouse=True)
def clean():
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    yield
    reasoning.set_sink(None)
    reasoning.clear(CHAT)
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)


def collect() -> list[tuple[str, str]]:
    taken: list[tuple[str, str]] = []
    reasoning.set_sink(lambda chat_id, delta: taken.append((chat_id, delta)))
    return taken


def test_answer_text_is_not_reasoning():
    taken = collect()
    reasoning.on_stream_delta(delta="All green.", kind="text", surface="yui")
    assert taken == []
    assert reasoning.live_text(CHAT) == ""


def test_another_platforms_reasoning_is_not_ours():
    taken = collect()
    reasoning.on_stream_delta(delta="thinking", kind="reasoning", surface="telegram")
    assert taken == []
    assert reasoning.live_text(CHAT) == ""


def test_a_reasoning_delta_reaches_the_sink_and_accumulates():
    taken = collect()
    reasoning.on_stream_delta(delta="I will ", kind="reasoning", surface="yui")
    reasoning.on_stream_delta(delta="check the log.", kind="reasoning", surface="yui")
    assert taken == [(CHAT, "I will "), (CHAT, "check the log.")]
    assert reasoning.live_text(CHAT) == "I will check the log."


def test_a_new_turn_starts_with_no_reasoning():
    reasoning.on_stream_delta(delta="stale", kind="reasoning", surface="yui")
    reasoning.clear(CHAT)
    assert reasoning.live_text(CHAT) == ""
