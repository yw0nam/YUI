from __future__ import annotations

import signal
from collections.abc import Mapping

from yui_notify import config
from yui_notify.hook.output import hook_output
from yui_notify.threads.answer import wait_answer
from yui_notify.threads.body import terminal_state
from yui_notify.threads.client import put


def wait_for_answer(url: str, body: dict, phase: str, cap: float, env: Mapping[str, str]) -> dict | None:
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, signal.default_int_handler)
    try:
        answer = wait_answer(url, body["ask"]["ask_id"], cap, env)
        if answer and not answer.get("release"):
            return hook_output(phase, answer)
    except KeyboardInterrupt:  # SIGINT, SIGTERM, SIGHUP: close the ask below
        pass
    closing = {**body, "state": terminal_state(phase), "ask": None, "entries": []}
    status, _, error = put(url, closing)
    if error:
        config.write_error(env, url, status, error)
    return None
