from __future__ import annotations

import signal
from collections.abc import Mapping

from yui_notify import config
from yui_notify.hook import ask_marker
from yui_notify.hook.output import hook_output
from yui_notify.threads.answer import wait_answer
from yui_notify.threads.body import terminal_state
from yui_notify.threads.client import put


def interrupt_on_signals() -> None:
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, signal.default_int_handler)


def close_ask(url: str, body: dict, phase: str, env: Mapping[str, str]) -> None:
    closing = {**body, "state": terminal_state(phase), "ask": None, "entries": []}
    status, _, error = put(url, closing)
    if error:
        config.write_error(env, url, status, error)


def close_matched_ask(env: Mapping[str, str], thread: str, tool_name: str, tool_input: dict) -> None:
    marker = ask_marker.matching(env, thread, tool_name, tool_input)
    if not marker:
        return
    url = marker["url"]
    closing = {**marker["body"], "state": "working", "ask": None, "entries": []}
    status, _, error = put(url, closing)
    if error:
        config.write_error(env, url, status, error)
    ask_marker.remove(env, thread)


def wait_for_answer(
    url: str, body: dict, phase: str, cap: float, env: Mapping[str, str], thread: str
) -> dict | None:
    interrupt_on_signals()
    answered = None
    gone = False
    try:
        answer, gone = wait_answer(url, body["ask"]["ask_id"], cap, env)
        if isinstance(answer, dict) and answer and not answer.get("release"):
            answered = hook_output(phase, answer)
    except KeyboardInterrupt:  # SIGINT, SIGTERM, SIGHUP: close the ask below
        pass
    # a closed ask (410) needs no closing PUT: whoever closed it already updated the Thread
    if answered is None and not gone:
        close_ask(url, body, phase, env)
    ask_marker.remove_if_own(env, thread, body["ask"]["ask_id"])
    return answered
