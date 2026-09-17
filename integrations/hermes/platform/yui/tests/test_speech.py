"""The answer as it is streamed: the hook that hands its text to the adapter."""

from __future__ import annotations

import pytest
from yui import speech, state

CHAT = "yui-3f9a2c1d"
# A gateway turn runs its agent under a task id equal to the session id.
ANSWER = "20260917_101010_ab12:20260917_101010_ab12:0f3c9a1e"
REVIEW = "20260917_101010_ab12:4b1c0f7e-3a2d-4f5e-9c8b-1a2b3c4d5e6f:0f3c9a1e"


@pytest.fixture(autouse=True)
def clean():
    state.set_connected(CHAT, True)
    yield
    speech.set_sink(None)
    state.set_connected(CHAT, False)


def collect() -> list[tuple]:
    taken: list[tuple] = []
    speech.set_sink(lambda *handed: taken.append(handed))
    return taken


def test_a_gateway_turns_answer_reaches_the_sink_for_the_sole_connected_client():
    """The gateway's session context is invisible on the hook thread."""
    taken = collect()
    speech.on_stream_delta(
        delta="All green.", kind="text", turn_id=ANSWER, iteration=2, session_id="s", surface="yui"
    )
    assert taken == [(CHAT, ANSWER, 2, "All green.")]


def test_reasoning_is_not_the_answer():
    taken = collect()
    speech.on_stream_delta(delta="thinking", kind="reasoning", turn_id=ANSWER, iteration=1, surface="yui")
    assert taken == []


def test_another_platforms_answer_is_not_ours():
    taken = collect()
    speech.on_stream_delta(delta="All green.", kind="text", turn_id=ANSWER, iteration=1, surface="telegram")
    assert taken == []


@pytest.mark.parametrize("turn_id", [REVIEW, "", None, "20260917_101010_ab12"])
def test_text_streamed_outside_a_gateway_turn_is_not_the_reply(turn_id):
    """A background review streams on this surface under a task of its own."""
    taken = collect()
    speech.on_stream_delta(delta="Noted.", kind="text", turn_id=turn_id, iteration=1, surface="yui")
    assert taken == []


def test_a_delta_with_no_single_client_to_speak_to_reaches_the_sink_with_no_chat():
    """The adapter learns that this text reached no client."""
    taken = collect()
    state.set_connected(CHAT, False)
    speech.on_stream_delta(delta="All green.", kind="text", turn_id=ANSWER, iteration=1, surface="yui")
    assert taken == [("", ANSWER, 1, "All green.")]
