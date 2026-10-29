from __future__ import annotations

import os

from yui_notify.config import endpoint_error
from yui_notify.label import short_hostname
from yui_notify.post import get, put
from yui_notify.thread import TITLE_MAX

UNREACHABLE = "YUI is not listening at {url} (External signals off, wrong port, or no tunnel)"
FAILURES = {
    404: "unknown or invalid thread id: {url}",
    503: "YUI is busy: every answer wait is in use: {url}",
}
PROBE_PATH = "/threads/yui-notify-probe/answer?ask_id=probe&wait=0"


def _failure(url: str, status: int | None) -> str:
    if status is None:
        return UNREACHABLE.format(url=url)
    return FAILURES.get(status, f"unexpected HTTP {status} from {{url}}").format(url=url)


def probe_failure(endpoint: str) -> str | None:
    invalid = endpoint_error(endpoint)
    if invalid:
        return invalid
    url = endpoint + PROBE_PATH
    status, _, _ = get(url, 2)
    if status == 404:
        return None
    if status == 400:
        return f"update YUI: Threads are not supported at {url}"
    return _failure(url, status)


def probe(endpoint: str) -> int:
    failure = probe_failure(endpoint)
    print(failure or f"ok: YUI is listening at {endpoint}{PROBE_PATH}")
    return 1 if failure else 0


def send_test(endpoint: str) -> int:
    invalid = endpoint_error(endpoint)
    if invalid:
        print(invalid)
        return 1
    url = endpoint + "/threads/yui-notify:test:" + short_hostname()
    body = {
        "source": "yui-notify",
        "title": os.path.basename(os.getcwd())[:TITLE_MAX],
        "state": "completed",
        "entries": [{"role": "system", "text": "Test Thread from the yui-notify setup."}],
        "ask": None,
    }
    status, _, error = put(url, body)
    if status is not None and 200 <= status < 300 and not error:
        print(f"sent: HTTP {status}")
        return 0
    print(_failure(url, status))
    return 1
