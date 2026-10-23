from __future__ import annotations

HEAD = 200
TAIL = 500


def excerpt(message: str) -> str:
    # head+tail keeps a long report's opening and result; no model is called
    if len(message) <= HEAD + TAIL:
        return message
    return message[:HEAD] + "\n…\n" + message[-TAIL:]
