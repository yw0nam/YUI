"""Speech into sentences, and the expression cues onto those sentences.

The client renders a reply as ordered segments: a segment's cues play, then its speech goes to
TTS. The model names the sentence a cue belongs before; cues that name nothing take the sentences
no other cue claimed.
"""

from __future__ import annotations

from typing import NamedTuple

# CJK terminators close a sentence on their own; an ASCII one closes it only when whitespace or
# the end of the text follows, so a decimal point does not cut the speech.
_ASCII_TERMINATORS = ".!?"
_CJK_TERMINATORS = "。！？"
_TERMINATORS = _ASCII_TERMINATORS + _CJK_TERMINATORS


class Placement(NamedTuple):
    """One gated cue and the opening words of the sentence the model placed it before."""

    cue: dict
    sentence: str


def _ends_sentence(text: str, index: int) -> bool:
    char = text[index]
    if char in _CJK_TERMINATORS:
        return True
    if char not in _ASCII_TERMINATORS:
        return False
    return index + 1 >= len(text) or text[index + 1].isspace()


def split_sentences(text: str) -> list[str]:
    """Cut ``text`` at sentence terminators and newlines; a terminator stays with its sentence."""
    sentences: list[str] = []
    start = 0
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\n":
            sentences.append(text[start:index])
            index += 1
            start = index
            continue
        if char in _TERMINATORS and _ends_sentence(text, index):
            while index + 1 < len(text) and text[index + 1] in _TERMINATORS:
                index += 1
            index += 1
            sentences.append(text[start:index])
            start = index
            continue
        index += 1
    sentences.append(text[start:])
    return [s for s in (s.strip() for s in sentences) if s]


def _normalize(text: str) -> str:
    return " ".join(text.split()).casefold()


def _match(sentences: list[str], hint: str) -> int | None:
    """The sentence this hint names: the first one it opens, else the first one holding it."""
    wanted = _normalize(hint)
    if not wanted:
        return None
    normalized = [_normalize(s) for s in sentences]
    for index, sentence in enumerate(normalized):
        if sentence.startswith(wanted):
            return index
    for index, sentence in enumerate(normalized):
        if wanted in sentence:
            return index
    return None


def build_segments(speech: str, placements: list[Placement]) -> list[dict]:
    """The ``render`` frame's segments: every sentence, each carrying the cues that landed on it."""
    sentences = split_sentences(speech)
    if not sentences:
        return []
    cues: list[list[dict]] = [[] for _ in sentences]
    unplaced: list[dict] = []
    for placement in placements:
        index = _match(sentences, placement.sentence)
        if index is None:
            unplaced.append(placement.cue)
        else:
            cues[index].append(placement.cue)
    free = [index for index, holding in enumerate(cues) if not holding]
    for offset, cue in enumerate(unplaced):
        cues[free[offset] if offset < len(free) else len(sentences) - 1].append(cue)
    return [{"cues": cues[index], "speech": sentence} for index, sentence in enumerate(sentences)]
