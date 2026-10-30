from __future__ import annotations

import math
import signal
import time
from collections.abc import Mapping
from urllib.parse import urlencode

from yui_notify import config
from yui_notify.hook.output import hook_output
from yui_notify.threads.body import terminal_state
from yui_notify.threads.client import get, put


def wait_for_answer(url: str, body: dict, phase: str, cap: float, env: Mapping[str, str]) -> dict | None:
    deadline = time.monotonic() + cap
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, signal.default_int_handler)
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining < 1:
                break
            seconds = min(25, math.floor(remaining))
            poll = url + "/answer?" + urlencode({"ask_id": body["ask"]["ask_id"], "wait": seconds})
            status, answer, error = get(poll, seconds + 5)
            if status == 200 and not error:
                if isinstance(answer, dict) and answer.get("release"):
                    break
                return hook_output(phase, answer)
            if status != 204 or error:
                if error:
                    config.write_error(env, poll, status, error)
                break
    except KeyboardInterrupt:  # SIGINT, SIGTERM, SIGHUP: close the ask below
        pass
    closing = {**body, "state": terminal_state(phase), "ask": None, "entries": []}
    status, _, error = put(url, closing)
    if error:
        config.write_error(env, url, status, error)
    return None
