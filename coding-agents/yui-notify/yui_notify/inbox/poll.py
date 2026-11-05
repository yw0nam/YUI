from __future__ import annotations

import os
import time
from collections.abc import Mapping
from urllib.parse import urlencode

from yui_notify import config
from yui_notify.inbox.post import post
from yui_notify.threads.client import get


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def poll(url: str, ask_id: str, pid: int, env: Mapping[str, str]) -> int:
    poll_url = url + "/answer?" + urlencode({"ask_id": ask_id, "wait": 25})
    while _alive(pid):
        status, answer, error = get(poll_url, 30)
        if status == 204 and not error:
            continue
        if status == 200 and not error:
            text = answer.get("text") if isinstance(answer, dict) else None
            if isinstance(text, str) and text:
                post(text, env)
            return 0
        if status in (404, 410):
            return 0
        config.write_error(env, poll_url, status, error)
        time.sleep(5)  # open asks survive a YUI restart, so keep asking
    return 0
