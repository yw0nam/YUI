from __future__ import annotations

from typing import Any
from uuid import uuid4

PROMPT_MAX = 500
LABEL_MAX = 64
OPTIONS_MAX = 6


def _usable(question: Any) -> bool:
    if not isinstance(question, dict):
        return False
    text, options = question.get("question"), question.get("options")
    return (
        isinstance(text, str)
        and bool(text)
        and isinstance(options, list)
        and 1 <= len(options) <= OPTIONS_MAX
        and all(isinstance(o, dict) and isinstance(o.get("label"), str) and o["label"] for o in options)
    )


def usable_questions(tool_input: Any) -> list | None:
    questions = tool_input.get("questions") if isinstance(tool_input, dict) else None
    return questions if isinstance(questions, list) and questions and all(map(_usable, questions)) else None


def new_ask_id(index: int) -> str:
    return f"q:{index}:{uuid4().hex}"


def question_ask(ask_id: str, question: dict) -> dict:
    ask = {
        "ask_id": ask_id,
        "prompt": question["question"][:PROMPT_MAX],
        "choices": [
            {"id": f"o{i}", "label": o["label"][:LABEL_MAX]} for i, o in enumerate(question["options"])
        ],
        "text": True,
        "placeholder": "Or type your own answer",
    }
    if question.get("multiSelect") is True:
        ask["multiple"] = True
    return ask


def answer_value(question: dict, answer: dict) -> str | None:
    choices = answer.get("choices")
    picked = [answer.get("choice"), *(choices if isinstance(choices, list) else [])]
    parts = [o["label"] for i, o in enumerate(question["options"]) if f"o{i}" in picked]
    text = answer.get("text")
    if isinstance(text, str) and text:
        parts.append(text)
    return ", ".join(parts) or None
