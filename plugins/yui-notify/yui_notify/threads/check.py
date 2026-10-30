from __future__ import annotations

import os
from collections.abc import Mapping
from uuid import uuid4

from yui_notify.config import endpoint_error
from yui_notify.host.label import short_hostname
from yui_notify.threads.answer import wait_answer
from yui_notify.threads.body import TITLE_MAX
from yui_notify.threads.client import get, put

UNREACHABLE = "YUI is not listening at {url} (External signals off, wrong port, or no tunnel)"
FAILURES = {
    404: "unknown or invalid thread id: {url}",
    503: "YUI is busy: every answer wait is in use: {url}",
}
ANSWER_WAIT = 60
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


def send_test(endpoint: str, env: Mapping[str, str]) -> int:
    invalid = endpoint_error(endpoint)
    if invalid:
        print(invalid)
        return 1
    url = endpoint + "/threads/yui-notify:test:" + short_hostname()
    ask_id = "test:" + uuid4().hex
    body = {
        "source": "yui-notify",
        "title": os.path.basename(os.getcwd())[:TITLE_MAX],
        "state": "input-required",
        "entries": [{"role": "system", "text": "Test Thread from the yui-notify setup."}],
        "ask": {
            "ask_id": ask_id,
            "prompt": "Did this test Thread arrive?",
            "text": False,
            "choices": [{"id": "arrived", "label": "Arrived", "tone": "primary"}],
        },
    }
    status, _, error = put(url, body)
    if status is None or not 200 <= status < 300 or error:
        print(_failure(url, status))
        return 1
    print(f"sent: HTTP {status}; answer it in YUI's Threads window within {ANSWER_WAIT} s", flush=True)
    answer = None
    try:
        answer = wait_answer(url, ask_id, ANSWER_WAIT, env)
    except KeyboardInterrupt:
        return 1
    finally:
        put(
            url, {**body, "state": "completed", "ask": None, "entries": []}
        )  # an answered Thread turns working
    print("answered: Arrived" if answer else f"no answer within {ANSWER_WAIT} s")
    return 0 if answer else 1
