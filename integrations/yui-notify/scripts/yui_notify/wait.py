from __future__ import annotations

import math
import time
from collections.abc import Mapping
from urllib.parse import urlencode

from yui_notify import config
from yui_notify.post import get, put
from yui_notify.thread import hook_output


def wait_for_answer(url: str, body: dict, phase: str, cap: float, env: Mapping[str, str]) -> dict | None:
    deadline = time.monotonic() + cap
    while True:
        remaining = deadline - time.monotonic()
        if remaining < 1:
            break
        seconds = min(25, math.floor(remaining))
        poll = url + "/answer?" + urlencode({"ask_id": body["ask"]["ask_id"], "wait": seconds})
        status, answer, error = get(poll, seconds + 5)
        if status == 200 and not error:
            return hook_output(phase, answer)
        if status != 204 or error:
            if error:
                config.write_error(env, poll, status, error)
            break
    closing = {**body, "state": "completed" if phase == "Stop" else "working", "ask": None, "entries": []}
    status, _, error = put(url, closing)
    if error:
        config.write_error(env, url, status, error)
    return None
