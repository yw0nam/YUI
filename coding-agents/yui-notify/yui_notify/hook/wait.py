from __future__ import annotations

import signal
import time
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


def close_matched_ask(
    env: Mapping[str, str], session: str, tool_name: str, tool_input: dict, cap: float
) -> None:
    marker = ask_marker.matching(env, session, tool_name, tool_input)
    if not marker:
        return
    # a marker older than the wait cap names an ask that already closed at the cap
    if time.time() - marker.get("written_at", 0) > cap:
        ask_marker.remove(env, session)
        return
    url = marker["url"]
    closing = {**marker["body"], "state": "working", "ask": None, "entries": []}
    status, _, error = put(url, closing)
    if error:
        config.write_error(env, url, status, error)
    ask_marker.remove(env, session)


def wait_for_answer(
    url: str, body: dict, phase: str, cap: float, env: Mapping[str, str], session: str
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
    ask_marker.remove_if_own(env, session, body["ask"]["ask_id"])
    return answered
