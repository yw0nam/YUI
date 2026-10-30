from __future__ import annotations

import argparse
import contextlib
import os
import sys
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.hook.run import run_hook
from yui_notify.inbox.poll import poll
from yui_notify.threads.check import probe, send_test


def main(
    argv: list[str] | None = None, stdin: TextIO = sys.stdin, env: Mapping[str, str] = os.environ
) -> int:
    parser = argparse.ArgumentParser(prog="yui-notify")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hook")
    inbox = sub.add_parser("inbox")
    for name in ("url", "ask_id", "pid"):
        inbox.add_argument(name)
    for name in ("probe", "test"):
        p = sub.add_parser(name)
        p.add_argument("--endpoint")
    args = parser.parse_args(argv)
    if args.cmd == "hook":
        with contextlib.suppress(Exception, KeyboardInterrupt):  # a hook never fails the agent
            run_hook(env, stdin)
        return 0
    if args.cmd == "inbox":
        with contextlib.suppress(Exception, KeyboardInterrupt):  # a poller never fails loudly
            return poll(args.url, args.ask_id, int(args.pid), env)
        return 0
    url = args.endpoint or config.load(env)["endpoint"]
    return probe(url) if args.cmd == "probe" else send_test(url, env)
