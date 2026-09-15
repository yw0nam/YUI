"""The backend's reasoning: the live stream hook and the block the gateway prepends to a reply."""

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


def test_the_prepended_block_is_split_off_the_reply():
    block, reply = reasoning.split_block(
        "\U0001f4ad **Reasoning:**\n```\nThe log is the first place to look.\n```\n\nAll green."
    )
    assert block == "The log is the first place to look."
    assert reply == "All green."


def test_a_truncated_block_is_split_the_same_way():
    body = "\n".join(f"line {n}" for n in range(15)) + "\n_... (4 more lines)_"
    block, reply = reasoning.split_block(f"\U0001f4ad **Reasoning:**\n```\n{body}\n```\n\nAll green.")
    assert block == body
    assert reply == "All green."


def test_a_reply_that_merely_starts_with_the_emoji_is_left_alone():
    spoken = "\U0001f4ad I was thinking about that too."
    assert reasoning.split_block(spoken) == ("", spoken)


def test_a_plain_reply_is_left_alone():
    assert reasoning.split_block("All green.") == ("", "All green.")
