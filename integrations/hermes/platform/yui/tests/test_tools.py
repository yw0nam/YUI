"""The generate_express tool: one call per reply carrying every cue in speaking order."""

from __future__ import annotations

import json

import pytest
from gateway_stub import STUB_ENV
from yui.src.express import tools
from yui.src.express.gate import Vocabulary
from yui.src.express.segments import Placement
from yui.src.turns import state

ENUM_TABLE = {"😆": "joyfully", "👂": "whisper"}


@pytest.fixture(autouse=True)
def clean():
    state.reset("yui")
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = "yui"
    yield
    state.reset("yui")
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)


def cues_property(vocab: Vocabulary) -> dict:
    return tools.build_schema(vocab)["parameters"]["properties"]["cues"]


def test_the_tool_takes_one_list_of_cues():
    schema = tools.build_schema(Vocabulary())
    assert schema["parameters"]["required"] == ["cues"]
    assert cues_property(Vocabulary())["type"] == "array"


def test_each_cue_carries_the_published_ids_as_enums():
    fields = cues_property(Vocabulary(emotion_ids=["happy", "sad"], motion_ids=["dance"]))["items"]
    assert fields["properties"]["emotion_id"]["enum"] == ["happy", "sad"]
    assert fields["properties"]["motion_id"]["enum"] == ["dance"]
    assert fields["additionalProperties"] is False


def test_a_cue_names_the_sentence_it_is_placed_before():
    fields = cues_property(Vocabulary())["items"]
    assert "sentence" in fields["properties"]
    assert "opening words" in fields["properties"]["sentence"]["description"]


def test_the_description_asks_for_one_call_per_reply():
    description = tools.build_schema(Vocabulary())["description"]
    assert "once per reply" in description
    assert "never" in description


def test_an_empty_emotion_vocabulary_drops_emotion_from_the_schema_and_the_description():
    vocab = Vocabulary(emotion_ids=[], motion_ids=["dance"])
    assert "emotion_id" not in cues_property(vocab)["items"]["properties"]
    assert "facial expression" not in tools.build_schema(vocab)["description"]


def test_an_empty_motion_vocabulary_drops_motion_from_the_schema_and_the_description():
    schema = tools.build_schema(Vocabulary(emotion_ids=["happy"], motion_ids=[]))
    assert (
        "motion_id"
        not in cues_property(Vocabulary(emotion_ids=["happy"], motion_ids=[]))["items"]["properties"]
    )
    assert "body motion" not in schema["description"]


def test_enum_mode_puts_the_tag_table_in_the_schema():
    fields = cues_property(Vocabulary(emotion_text_mode="enum", emotion_text_map=ENUM_TABLE))["items"]
    emotion_text = fields["properties"]["emotion_text"]
    assert emotion_text["enum"] == ["😆", "👂"]
    assert "😆 = joyfully" in emotion_text["description"]


def test_free_mode_leaves_the_tag_open():
    fields = cues_property(Vocabulary())["items"]
    assert "enum" not in fields["properties"]["emotion_text"]


def test_the_handler_buffers_every_gated_cue_with_its_sentence():
    state.set_vocabulary("yui", Vocabulary(emotion_ids=["happy"], motion_ids=["idle"]))
    tools.handler({"cues": [{"emotion_id": "happy", "sentence": "One"}, {"motion_id": "idle"}]})
    assert state.pop_cues("yui") == [
        Placement({"emotion_id": "happy"}, "One"),
        Placement({"motion_id": "idle"}, ""),
    ]


def test_the_handler_drops_an_unknown_id_and_still_succeeds():
    state.set_vocabulary("yui", Vocabulary(emotion_ids=["happy"], motion_ids=[]))
    result = json.loads(tools.handler({"cues": [{"emotion_id": "smug", "sentence": "One"}]}))
    assert result["ok"] is True
    assert result["cues"][0]["warnings"] == ["emotion_id 'smug' not in live vocabulary (dropped)"]
    assert state.pop_cues("yui") == []


def test_a_call_with_no_cues_succeeds_and_buffers_nothing():
    result = json.loads(tools.handler({}))
    assert result["ok"] is True
    assert state.pop_cues("yui") == []
