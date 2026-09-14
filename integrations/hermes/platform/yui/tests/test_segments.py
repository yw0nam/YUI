"""Sentence splitting and cue placement: what the render frame's segments look like."""

from __future__ import annotations

from yui.segments import Placement, build_segments, place_matched, split_sentences


def test_the_terminator_stays_with_its_sentence():
    assert split_sentences("All green. Want details?") == ["All green.", "Want details?"]


def test_cjk_terminators_end_a_sentence_without_a_following_space():
    assert split_sentences("全部緑です。詳しく聞く？") == ["全部緑です。", "詳しく聞く？"]


def test_a_run_of_terminators_stays_together():
    assert split_sentences("Really?! Yes.") == ["Really?!", "Yes."]


def test_a_decimal_point_does_not_split_a_sentence():
    assert split_sentences("It took 3.5 seconds.") == ["It took 3.5 seconds."]


def test_a_newline_ends_a_sentence_and_leaves_no_blank():
    assert split_sentences("First line\n\nSecond line") == ["First line", "Second line"]


def test_a_tail_without_a_terminator_is_still_a_sentence():
    assert split_sentences("no terminator here") == ["no terminator here"]


def test_blank_speech_has_no_sentences():
    assert split_sentences("   \n  ") == []


def test_every_sentence_becomes_a_segment_even_without_cues():
    assert build_segments("All green. Want details?", []) == [
        {"cues": [], "speech": "All green."},
        {"cues": [], "speech": "Want details?"},
    ]


def test_a_cue_lands_on_the_sentence_it_names():
    placements = [Placement({"emotion_id": "curious"}, "Want details")]
    segments = build_segments("All green. Want details?", placements)
    assert segments[0]["cues"] == []
    assert segments[1]["cues"] == [{"emotion_id": "curious"}]


def test_matching_ignores_case_and_extra_spacing():
    placements = [Placement({"emotion_id": "happy"}, "  all   GREEN ")]
    segments = build_segments("All green. Want details?", placements)
    assert segments[0]["cues"] == [{"emotion_id": "happy"}]


def test_a_sentence_that_starts_with_the_hint_wins_over_one_that_contains_it():
    speech = "I checked the tests. The tests passed."
    placements = [Placement({"emotion_id": "happy"}, "The tests")]
    segments = build_segments(speech, placements)
    assert segments[0]["cues"] == []
    assert segments[1]["cues"] == [{"emotion_id": "happy"}]


def test_a_hint_found_only_inside_a_sentence_still_matches():
    placements = [Placement({"emotion_id": "happy"}, "checked the tests")]
    segments = build_segments("I checked the tests. Done.", placements)
    assert segments[0]["cues"] == [{"emotion_id": "happy"}]


def test_cues_without_a_hint_fill_the_free_sentences_in_order():
    placements = [Placement({"emotion_id": "happy"}, ""), Placement({"motion_id": "idle"}, "")]
    segments = build_segments("One. Two. Three.", placements)
    assert segments[0]["cues"] == [{"emotion_id": "happy"}]
    assert segments[1]["cues"] == [{"motion_id": "idle"}]
    assert segments[2]["cues"] == []


def test_a_free_sentence_is_one_no_matched_cue_took():
    placements = [
        Placement({"emotion_id": "happy"}, "One"),
        Placement({"motion_id": "idle"}, ""),
    ]
    segments = build_segments("One. Two.", placements)
    assert segments[0]["cues"] == [{"emotion_id": "happy"}]
    assert segments[1]["cues"] == [{"motion_id": "idle"}]


def test_two_cues_naming_the_same_sentence_are_appended_to_it():
    placements = [
        Placement({"emotion_id": "happy"}, "One"),
        Placement({"motion_id": "idle"}, "One"),
    ]
    segments = build_segments("One. Two.", placements)
    assert segments[0]["cues"] == [{"emotion_id": "happy"}, {"motion_id": "idle"}]
    assert segments[1]["cues"] == []


def test_cues_with_nowhere_left_join_the_last_sentence():
    placements = [Placement({"emotion_id": str(n)}, "") for n in range(3)]
    segments = build_segments("One. Two.", placements)
    assert segments[0]["cues"] == [{"emotion_id": "0"}]
    assert segments[1]["cues"] == [{"emotion_id": "1"}, {"emotion_id": "2"}]


def test_speech_with_no_sentences_yields_no_segments():
    assert build_segments("", [Placement({"emotion_id": "happy"}, "")]) == []


def test_the_placement_hint_never_reaches_the_frame():
    segments = build_segments("One.", [Placement({"emotion_id": "happy"}, "One")])
    assert segments[0]["cues"] == [{"emotion_id": "happy"}]


def test_only_the_named_cues_ride_on_commentary():
    placements = [
        Placement({"emotion_id": "curious"}, "Let me check"),
        Placement({"emotion_id": "happy"}, "All green"),
    ]
    segments, waiting = place_matched("Let me check the tests.", placements)
    assert segments == [{"cues": [{"emotion_id": "curious"}], "speech": "Let me check the tests."}]
    assert waiting == [Placement({"emotion_id": "happy"}, "All green")]


def test_commentary_with_no_sentences_keeps_every_cue_waiting():
    placements = [Placement({"emotion_id": "happy"}, "")]
    assert place_matched("", placements) == ([], placements)
