from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import time
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.adapters import parse_event
from yui_notify.envelope import build_signal
from yui_notify.label import context, make_label
from yui_notify.post import post
from yui_notify.summary import summarize

UNREACHABLE = "YUI is not listening at {url} (External signals off, wrong port, or no tunnel)"
FAILURES = {
    404: "no such preset: {url}",
    503: "the preset's pet window is closed: {url}",
}


def _hook(env: Mapping[str, str], stdin: TextIO) -> None:
    if env.get("YUI_NOTIFY_CHILD") == "1":
        return
    try:
        event = parse_event(json.load(stdin), env)
    except ValueError:
        return
    cfg = config.load(env)
    if event is None or cfg["events"][event.phase] == "drop":
        return
    summary = summarize(event.text, cfg["summary"]) if event.phase == "done" else ""
    body = build_signal(
        event, context(event.cwd, env), cfg["events"][event.phase], summary, int(time.time() * 1000)
    )
    url = cfg["endpoint"] + "/signals"
    status, error = post(url, body)
    if error:
        config.write_error(env, url, status, error)


def _probe(url: str) -> int:
    status, _ = post(url, {"envelope": None})
    if status == 400:
        print(f"ok: YUI is listening at {url}")
        return 0
    print(_failure(url, status))
    return 1


def _failure(url: str, status: int | None) -> str:
    if status is None:
        return UNREACHABLE.format(url=url)
    return FAILURES.get(status, f"unexpected HTTP {status} from {{url}}").format(url=url)


def _test(url: str, delivery: str) -> int:
    ms = int(time.time() * 1000)
    ctx = context(os.getcwd(), os.environ)
    body = {
        "signals": [{"summary": "Test signal from the yui-notify setup."}],
        "envelope": {
            "source": "yui-notify",
            "event_type": "yui-notify.test",
            "delivery": delivery,
            "event_id": f"yui-notify-test:{ms}",
            "label": make_label(ctx),
            "occurred_at": ms,
        },
    }
    status, _ = post(url, body)
    if status is not None and 200 <= status < 300:
        print(f"sent: HTTP {status}")
        return 0
    print(_failure(url, status))
    return 1


def main(
    argv: list[str] | None = None, stdin: TextIO = sys.stdin, env: Mapping[str, str] = os.environ
) -> int:
    parser = argparse.ArgumentParser(prog="yui-notify")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hook")
    for name in ("probe", "test"):
        p = sub.add_parser(name)
        p.add_argument("--endpoint")
    sub.choices["test"].add_argument("--delivery", choices=["urgent", "batched"], default="urgent")
    args = parser.parse_args(argv)
    if args.cmd == "hook":
        with contextlib.suppress(Exception):  # a hook never fails the agent
            _hook(env, stdin)
        return 0
    url = (args.endpoint or config.load(env)["endpoint"]).rstrip("/") + "/signals"
    return _probe(url) if args.cmd == "probe" else _test(url, args.delivery)
