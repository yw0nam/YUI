"""Hermes clarify questions as Asks and answers as gateway replies."""

import json
import logging
from collections.abc import Callable

from agent.i18n import t
from tools.clarify_gateway import (
    _coerce_text_response,
    get_pending,
    mark_awaiting_text,
    resolve_gateway_clarify,
)

logger = logging.getLogger(__name__)


def cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def clarify_ask(question: str, choices: list[str] | None, clarify_id: str) -> tuple[dict, Callable]:
    entry = get_pending(clarify_id)
    multi = entry.multi_select if entry is not None else False
    body = {"prompt": question, "text": True}
    if choices:
        if len(choices) <= 6:
            body["choices"] = [{"id": str(i), "label": cut(c, 64)} for i, c in enumerate(choices, 1)]
        if len(choices) > 6 or any(len(c) > 64 for c in choices):
            body["prompt"] += "\n\n" + "\n".join(f"{i}. {c}" for i, c in enumerate(choices, 1))
        body["placeholder"] = cut(
            t("gateway.clarify.hint_multi" if multi else "gateway.clarify.hint_single"), 200
        )

    def resolve(choice: str | None, text: str | None) -> None:
        if choice is not None:
            value = choices[int(choice) - 1]
            if text is not None:
                value = f"{value}\n{text}"
            elif multi:
                value = json.dumps([value], ensure_ascii=False)
        else:
            mark_awaiting_text(clarify_id)
            entry = get_pending(clarify_id)
            if entry is None:
                return
            value = _coerce_text_response(entry, text)
            if value is None:
                return
        if not resolve_gateway_clarify(clarify_id, value):
            logger.debug("yui: clarify %s is no longer pending", clarify_id)

    return body, resolve
