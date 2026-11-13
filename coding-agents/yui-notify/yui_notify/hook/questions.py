from __future__ import annotations

import time
from collections.abc import Mapping

from yui_notify import config
from yui_notify.hook.wait import close_ask, interrupt_on_signals
from yui_notify.threads.answer import wait_answer
from yui_notify.threads.client import put
from yui_notify.threads.question import answer_value, new_ask_id, question_ask


def answer_questions(
    url: str, body: dict, questions: list, cap: float, env: Mapping[str, str]
) -> dict | None:
    # one deadline for every question: the hook timeout covers the whole call
    deadline = time.monotonic() + cap
    interrupt_on_signals()
    answers = {}
    try:
        for index, question in enumerate(questions):
            if index:
                body = {**body, "ask": question_ask(new_ask_id(index), question), "entries": []}
                status, _, error = put(url, body)
                if error:
                    config.write_error(env, url, status, error)
                    break
            answer, _ = wait_answer(url, body["ask"]["ask_id"], deadline - time.monotonic(), env)
            value = answer_value(question, answer) if isinstance(answer, dict) else None
            if value is None:
                break
            answers[question["question"]] = value
        else:
            decision = {"behavior": "allow", "updatedInput": {"questions": questions, "answers": answers}}
            return {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": decision}}
    except KeyboardInterrupt:  # SIGINT, SIGTERM, SIGHUP: close the ask below
        pass
    close_ask(url, body, "PermissionRequest", env)
    return None
