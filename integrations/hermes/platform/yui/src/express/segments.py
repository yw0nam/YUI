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


def _cut(text: str, complete: bool) -> tuple[list[str], int]:
    """The sentences ``text`` closes, and where the text after them starts. Text that is not
    ``complete`` closes no sentence at its end, where a terminator run may still grow."""
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
        if char in _TERMINATORS and (complete or index + 1 < len(text)) and _ends_sentence(text, index):
            while index + 1 < len(text) and text[index + 1] in _TERMINATORS:
                index += 1
            if not complete and index + 1 >= len(text):
                break
            index += 1
            sentences.append(text[start:index])
            start = index
            continue
        index += 1
    return sentences, start


def _spoken(sentences: list[str]) -> list[str]:
    return [s for s in (s.strip() for s in sentences) if s]


def split_sentences(text: str) -> list[str]:
    """Cut ``text`` at sentence terminators and newlines; a terminator stays with its sentence."""
    sentences, start = _cut(text, complete=True)
    return _spoken([*sentences, text[start:]])


def split_finished(text: str) -> tuple[list[str], int]:
    """The sentences of text still being written that no later character can change, and the
    length of ``text`` they cover."""
    sentences, start = _cut(text, complete=False)
    return _spoken(sentences), start


def _normalize(text: str) -> str:
    return " ".join(text.split()).casefold()


def opening_cues(sentence: str, placements: list[Placement]) -> list[Placement]:
    """The cues a sentence sent on its own takes: every one whose hint opens it, else the first
    that names no sentence."""
    spoken = _normalize(sentence)
    opened = [p for p in placements if _normalize(p.sentence) and spoken.startswith(_normalize(p.sentence))]
    if opened:
        return opened
    return next(([p] for p in placements if not _normalize(p.sentence)), [])


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


def place_matched(speech: str, placements: list[Placement]) -> tuple[list[dict], list[Placement]]:
    """Segments carrying only the cues this speech names, and the cues still waiting for theirs."""
    sentences = split_sentences(speech)
    if not sentences:
        return [], list(placements)
    cues: list[list[dict]] = [[] for _ in sentences]
    waiting: list[Placement] = []
    for placement in placements:
        index = _match(sentences, placement.sentence)
        if index is None:
            waiting.append(placement)
        else:
            cues[index].append(placement.cue)
    return [{"cues": cues[i], "speech": sentence} for i, sentence in enumerate(sentences)], waiting


def build_segments(speech: str, placements: list[Placement]) -> list[dict]:
    """The ``render`` frame's segments: every sentence, each carrying the cues that landed on it."""
    segments, waiting = place_matched(speech, placements)
    if not segments:
        return []
    free = [index for index, segment in enumerate(segments) if not segment["cues"]]
    for offset, placement in enumerate(waiting):
        target = free[offset] if offset < len(free) else len(segments) - 1
        segments[target]["cues"].append(placement.cue)
    return segments
