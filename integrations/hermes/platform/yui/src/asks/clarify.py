"""Hermes clarify questions as Asks and answers as gateway replies."""

import json
import logging
from collections.abc import Callable

from tools.clarify_gateway import (
    _coerce_text_response,
    get_pending,
    mark_awaiting_text,
    resolve_gateway_clarify,
)
from tools.clarify_tool import strip_recommended

logger = logging.getLogger(__name__)

MAX_CHOICES = 6
MAX_LABEL_CODE_POINTS = 64


def cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def clarify_ask(question: str, choices: list[str] | None, clarify_id: str) -> tuple[dict, Callable]:
    entry = get_pending(clarify_id)
    multi = entry.multi_select if entry is not None else False
    body = {"prompt": question, "text": True}
    if choices:
        if len(choices) <= MAX_CHOICES:
            body["choices"] = [
                {"id": str(i), "label": cut(c, MAX_LABEL_CODE_POINTS)} for i, c in enumerate(choices, 1)
            ]
        if len(choices) > MAX_CHOICES or any(len(c) > MAX_LABEL_CODE_POINTS for c in choices):
            body["prompt"] += "\n\n" + "\n".join(f"{i}. {c}" for i, c in enumerate(choices, 1))
        if multi and "choices" in body:
            body["multiple"] = True

    def resolve(choice: str | list[str] | None, text: str | None) -> None:
        if body.get("multiple"):
            values = [choices[int(id) - 1] for id in choice or []]
            if text is not None:
                values.append(text)
            value = json.dumps(values, ensure_ascii=False)
        elif choice is not None:
            value = choices[int(choice) - 1]
            if text is not None:
                # Hermes strips its recommendation label only from an answer that is the label alone.
                value = f"{strip_recommended(value)}\n{text}"
        else:
            mark_awaiting_text(clarify_id)
            entry = get_pending(clarify_id)
            if entry is None:
                return
            # The public resolve_text_response_for_session answers the oldest pending clarify, not this one.
            value = _coerce_text_response(entry, text)
        if not resolve_gateway_clarify(clarify_id, value):
            logger.debug("yui: clarify %s is no longer pending", clarify_id)

    return body, resolve
