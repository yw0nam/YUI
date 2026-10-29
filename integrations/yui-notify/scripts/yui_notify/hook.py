from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.adapters import parse_event
from yui_notify.check import probe_failure
from yui_notify.focus import host_app_in_front
from yui_notify.label import context
from yui_notify.post import put
from yui_notify.thread import build_thread, thread_id
from yui_notify.wait import wait_for_answer


def run_hook(env: Mapping[str, str], stdin: TextIO) -> None:
    try:
        event = parse_event(json.load(stdin), env)
    except ValueError:
        return
    if event is None:
        return
    cfg = config.load(env)
    if event.phase == "SessionStart":
        failure = probe_failure(cfg["endpoint"])
        if failure:
            print(json.dumps({"systemMessage": f"yui-notify: {failure}"}))
        return
    url = cfg["endpoint"] + "/threads/" + thread_id(event, env)
    front = event.agent == "codex" and event.phase == "PermissionRequest" and host_app_in_front(env)
    body = build_thread(event, context(event.cwd, env), front)
    status, _, error = put(url, body)
    if error:
        config.write_error(env, url, status, error)
        return
    if body.get("ask"):
        cap = cfg["wait"]["stop" if event.phase == "Stop" else "permission"]
        output = wait_for_answer(url, body, event.phase, cap, env)
        if output:
            print(json.dumps(output))
