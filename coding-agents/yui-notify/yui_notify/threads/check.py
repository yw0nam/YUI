from __future__ import annotations

import os

from yui_notify.config import endpoint_error
from yui_notify.host.label import short_hostname
from yui_notify.threads.body import TITLE_MAX
from yui_notify.threads.client import get, put

UNREACHABLE = "YUI is not listening at {url} (External signals off, wrong port, or no tunnel)"
FAILURES = {404: "unknown or invalid thread id: {url}"}
PROBE_PATH = "/threads/yui-notify-probe"


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
    if status == 405:
        return None
    if status in (400, 404):
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
        "state": "input-required",
        "entries": [
            {
                "role": "system",
                "text": "Test Thread from the yui-notify setup. Mark it read in YUI's Threads window.",
            }
        ],
    }
    status, _, error = put(url, body)
    if status is None or not 200 <= status < 300 or error:
        print(_failure(url, status))
        return 1
    print(f"sent: HTTP {status}; look for it in YUI's Threads window")
    return 0
