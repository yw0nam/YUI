"""Per-chat turn state: the cue buffer, the turn in flight, and who is connected."""

from __future__ import annotations

import pytest
from yui import state
from yui.gate import Vocabulary
from yui.segments import Placement


@pytest.fixture(autouse=True)
def clean():
    for chat in ("yui", "other"):
        state.reset(chat)
        state.set_connected(chat, False)
        state.set_turn_id(chat, None)
    yield
    for chat in ("yui", "other"):
        state.reset(chat)
        state.set_connected(chat, False)
        state.set_turn_id(chat, None)


def test_cues_pop_in_the_order_they_were_placed():
    state.append_cue("yui", {"emotion_id": "happy"}, "One")
    state.append_cue("yui", {"motion_id": "idle"}, "")
    assert state.pop_cues("yui") == [
        Placement({"emotion_id": "happy"}, "One"),
        Placement({"motion_id": "idle"}, ""),
    ]


def test_popping_empties_the_buffer():
    state.append_cue("yui", {"emotion_id": "happy"}, "")
    state.pop_cues("yui")
    assert state.pop_cues("yui") == []


def test_buffers_are_per_chat():
    state.append_cue("yui", {"emotion_id": "happy"}, "")
    state.append_cue("other", {"emotion_id": "sad"}, "")
    assert state.pop_cues("other") == [Placement({"emotion_id": "sad"}, "")]
    assert state.pop_cues("yui") == [Placement({"emotion_id": "happy"}, "")]


def test_an_empty_cue_carries_nothing_and_is_dropped():
    state.append_cue("yui", {}, "One")
    assert state.pop_cues("yui") == []


def test_reset_drops_a_previous_turns_cues():
    state.append_cue("yui", {"emotion_id": "happy"}, "")
    state.reset("yui")
    assert state.pop_cues("yui") == []


def test_nothing_is_renderable_until_a_vocabulary_is_published():
    assert state.vocabulary("yui").emotion_ids == []
    state.set_vocabulary("yui", Vocabulary(emotion_ids=["happy"], motion_ids=[]))
    assert state.vocabulary("yui").emotion_ids == ["happy"]


def test_reading_the_turn_id_leaves_it_in_place():
    state.set_turn_id("yui", "17893")
    assert state.turn_id("yui") == "17893"
    assert state.turn_id("yui") == "17893"


def test_taking_the_turn_id_removes_it():
    state.set_turn_id("yui", "17893")
    assert state.take_turn_id("yui") == "17893"
    assert state.take_turn_id("yui") is None
    assert state.turn_id("yui") is None


def test_delivery_mark_is_taken_once():
    state.mark_delivered("yui")
    assert state.take_delivered("yui") is True
    assert state.take_delivered("yui") is False


def test_connected_chats_are_the_ones_with_a_ready_socket():
    assert state.is_connected("yui") is False
    state.set_connected("yui", True)
    assert state.is_connected("yui") is True
    assert state.connected_chats() == ["yui"]
    state.set_connected("yui", False)
    assert state.connected_chats() == []
