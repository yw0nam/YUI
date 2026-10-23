from __future__ import annotations

import os
import time

from yui_notify.envelope import build_test_signal
from yui_notify.label import context
from yui_notify.post import post

UNREACHABLE = "YUI is not listening at {url} (External signals off, wrong port, or no tunnel)"
FAILURES = {
    404: "no such preset: {url}",
    503: "the preset's pet window is closed: {url}",
}
# an envelope that parses but is not an object: the ingress answers 200 and drops the group
PROBE_BODY = {"signals": [], "envelope": "yui-notify-probe"}


def _failure(url: str, status: int | None) -> str:
    if status is None:
        return UNREACHABLE.format(url=url)
    return FAILURES.get(status, f"unexpected HTTP {status} from {{url}}").format(url=url)


def probe(url: str) -> int:
    status, _ = post(url, PROBE_BODY)
    if status == 200:
        print(f"ok: YUI is listening at {url}")
        return 0
    print(_failure(url, status))
    return 1


def send_test(url: str, delivery: str) -> int:
    ctx = context(os.getcwd(), os.environ)
    status, _ = post(url, build_test_signal(ctx, delivery, int(time.time() * 1000)))
    if status is not None and 200 <= status < 300:
        print(f"sent: HTTP {status}")
        return 0
    print(_failure(url, status))
    return 1
