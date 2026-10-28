from __future__ import annotations

import json
import time
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.adapters import parse_event
from yui_notify.check import probe_failure
from yui_notify.envelope import build_signal
from yui_notify.excerpt import excerpt
from yui_notify.focus import host_app_in_front
from yui_notify.label import context
from yui_notify.post import post


def run_hook(env: Mapping[str, str], stdin: TextIO) -> None:
    try:
        event = parse_event(json.load(stdin), env)
    except ValueError:
        return
    if event is None:
        return
    cfg = config.load(env)
    if event.phase == "start":
        failure = probe_failure(cfg["endpoint"] + "/signals")
        if failure:
            # a synchronous hook's systemMessage reaches the user; plain stdout would reach the model
            print(json.dumps({"systemMessage": f"yui-notify: {failure}"}))
        return
    if cfg["events"][event.phase] == "drop" or host_app_in_front(env):
        return
    summary = excerpt(event.text) if event.phase == "done" else ""
    body = build_signal(
        event, context(event.cwd, env), cfg["events"][event.phase], summary, int(time.time() * 1000)
    )
    url = cfg["endpoint"] + "/signals"
    status, error = post(url, body)
    if error:
        config.write_error(env, url, status, error)
