from __future__ import annotations

import math
import time
from collections.abc import Mapping
from urllib.parse import urlencode

from yui_notify import config
from yui_notify.threads.client import get


def wait_answer(url: str, ask_id: str, cap: float, env: Mapping[str, str]) -> dict | None:
    deadline = time.monotonic() + cap
    while True:
        remaining = deadline - time.monotonic()
        if remaining < 1:
            return None
        seconds = min(25, math.floor(remaining))
        poll = url + "/answer?" + urlencode({"ask_id": ask_id, "wait": seconds})
        status, answer, error = get(poll, seconds + 5)
        if status == 200 and not error:
            return answer
        if status != 204 or error:
            if error:
                config.write_error(env, poll, status, error)
            return None
