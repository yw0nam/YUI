from __future__ import annotations

import argparse
import contextlib
import os
import sys
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.check import probe, send_test
from yui_notify.hook import run_hook


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
            run_hook(env, stdin)
        return 0
    url = (args.endpoint or config.load(env)["endpoint"]).rstrip("/") + "/signals"
    return probe(url) if args.cmd == "probe" else send_test(url, args.delivery)
