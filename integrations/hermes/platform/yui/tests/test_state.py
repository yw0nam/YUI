"""Per-chat turn state: the cue buffer, the open turns, and who is connected."""

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
        state.close_turns(chat)
        state.take_closing(chat)
    yield
    for chat in ("yui", "other"):
        state.reset(chat)
        state.set_connected(chat, False)
        state.close_turns(chat)
        state.take_closing(chat)


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
    assert state.vocabulary("yui") is None
    state.set_vocabulary("yui", Vocabulary(emotion_ids=["happy"], motion_ids=[]))
    assert state.vocabulary("yui").emotion_ids == ["happy"]


def test_reading_the_turn_id_leaves_it_in_place():
    state.open_turn("yui", "17893")
    assert state.turn_id("yui") == "17893"
    assert state.turn_id("yui") == "17893"


def test_a_turn_opened_inside_another_leaves_both_open():
    state.open_turn("yui", "17893")
    state.open_turn("yui", "17894")
    assert state.open_turns("yui") == ["17893", "17894"]
    assert state.turn_id("yui") == "17894"


def test_closing_ends_every_open_turn_most_recently_opened_first():
    state.open_turn("yui", "17893")
    state.open_turn("yui", "17894")
    assert state.close_turns("yui") == ["17894", "17893"]
    assert state.close_turns("yui") == []
    assert state.turn_id("yui") is None


def test_a_turn_joined_while_another_is_open_names_the_joined_turn():
    state.open_turn("yui", "17893")
    state.mark_joined("yui", "17894")
    assert state.turn_id("yui") == "17894"


def test_a_turn_opened_after_a_joined_one_names_the_opened_turn():
    state.open_turn("yui", "17893")
    state.mark_joined("yui", "17894")
    state.open_turn("yui", "17895")
    assert state.turn_id("yui") == "17895"


def test_a_joined_turn_that_later_opens_counts_once_in_arrival_order():
    state.open_turn("yui", "17893")
    state.mark_joined("yui", "17894")
    state.drop_joined("yui", "17894")
    state.open_turn("yui", "17894")
    assert state.turn_id("yui") == "17894"
    assert state.close_turns("yui") == ["17894", "17893"]


def test_after_forget_joined_the_last_open_turn_is_named():
    state.open_turn("yui", "17893")
    state.mark_joined("yui", "17894")
    state.forget_joined("yui")
    assert state.turn_id("yui") == "17893"


def test_closing_ends_the_open_turns_before_the_turns_that_joined_them():
    state.open_turn("yui", "17893")
    state.open_turn("yui", "17894")
    state.mark_joined("yui", "17895")
    state.mark_joined("yui", "17896")
    assert state.close_turns("yui") == ["17894", "17893", "17896", "17895"]
    assert state.close_turns("yui") == []


def test_the_closing_mark_is_taken_once():
    state.mark_closing("yui")
    assert state.take_closing("yui") is True
    assert state.take_closing("yui") is False


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
