"""The expression-cue gate: unknown ids drop, the call still succeeds."""

from __future__ import annotations

from yui.src.express.gate import Vocabulary, cue_of, tokenize_emotion_text, validate_cue

ENUM_TABLE = {"😆": "joyfully", "👂": "whisper", "😮‍💨": "sigh"}


def vocab(**overrides) -> Vocabulary:
    base = {
        "emotion_ids": ["happy", "sad"],
        "motion_ids": ["dance"],
        "emotion_text_mode": "free",
        "emotion_text_map": {},
    }
    base.update(overrides)
    return Vocabulary(**base)


def test_known_ids_pass_through():
    result = validate_cue({"emotion_id": "happy", "motion_id": "dance"}, vocab())
    assert result["ok"] is True
    assert result["warnings"] == []
    assert result["applied"]["emotion_id"] == "happy"
    assert result["applied"]["motion_id"] == "dance"


def test_unknown_emotion_id_is_dropped_with_a_warning():
    result = validate_cue({"emotion_id": "smug"}, vocab())
    assert result["ok"] is True
    assert result["applied"]["emotion_id"] is None
    assert result["warnings"] == ["emotion_id 'smug' not in live vocabulary (dropped)"]


def test_unknown_motion_id_is_dropped_with_a_warning():
    result = validate_cue({"motion_id": "moonwalk"}, vocab())
    assert result["applied"]["motion_id"] is None
    assert result["warnings"] == ["motion_id 'moonwalk' not in live vocabulary (dropped)"]


def test_free_mode_passes_emotion_text_untouched():
    result = validate_cue({"emotion_text": "[whisper]"}, vocab())
    assert result["applied"]["emotion_text"] == "[whisper]"
    assert result["warnings"] == []


def test_enum_mode_keeps_known_tokens_and_echoes_the_table():
    v = vocab(emotion_text_mode="enum", emotion_text_map=ENUM_TABLE)
    result = validate_cue({"emotion_text": "😆x👂"}, v)
    assert result["applied"]["emotion_text"] == "😆👂"
    assert "dropped" in result["warnings"][0]
    assert result["emotion_text_table"] == ENUM_TABLE


def test_enum_mode_with_no_known_token_yields_none():
    v = vocab(emotion_text_mode="enum", emotion_text_map=ENUM_TABLE)
    result = validate_cue({"emotion_text": "zzz"}, v)
    assert result["applied"]["emotion_text"] is None


def test_tokenizer_matches_the_longest_key_first():
    known, unknown = tokenize_emotion_text("😮‍💨 😆!", ENUM_TABLE)
    assert known == ["😮‍💨", "😆"]
    assert unknown == "!"


def test_caption_is_stripped_and_truncated():
    result = validate_cue({"caption": "  " + "あ" * 250 + "  "}, vocab())
    assert len(result["applied"]["caption"]) == 200
    assert "truncated" in result["warnings"][0]


def test_blank_caption_becomes_absent():
    result = validate_cue({"caption": "   "}, vocab())
    assert result["applied"]["caption"] is None
    assert result["warnings"] == []


def test_cue_of_omits_absent_fields():
    result = validate_cue({"emotion_id": "happy"}, vocab())
    assert cue_of(result["applied"]) == {"emotion_id": "happy"}


def test_an_empty_call_applies_nothing():
    result = validate_cue({}, vocab())
    assert cue_of(result["applied"]) == {}
    assert result["ok"] is True


def test_a_vocabulary_renders_nothing_until_the_client_publishes_one():
    assert Vocabulary().emotion_ids == []
    assert Vocabulary().motion_ids == []


def test_an_empty_published_list_stays_empty():
    v = Vocabulary.from_payload({"emotion_ids": [], "motion_ids": None})
    assert v.emotion_ids == []
    assert v.motion_ids == []
    assert v.emotion_text_mode == "free"


def test_blank_and_non_string_ids_are_dropped():
    v = Vocabulary.from_payload({"emotion_ids": ["happy", "  ", 3], "motion_ids": ["idle"]})
    assert v.emotion_ids == ["happy"]
    assert v.motion_ids == ["idle"]


def test_vocabulary_from_payload_takes_the_published_ids():
    v = Vocabulary.from_payload(
        {
            "emotion_ids": ["happy"],
            "motion_ids": ["dance"],
            "emotion_text_mode": "enum",
            "emotion_text_map": ENUM_TABLE,
        }
    )
    assert v.emotion_ids == ["happy"]
    assert v.motion_ids == ["dance"]
    assert v.emotion_text_mode == "enum"
    assert v.emotion_text_map == ENUM_TABLE
