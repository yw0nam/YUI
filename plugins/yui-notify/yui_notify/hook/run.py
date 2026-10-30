from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.channel.ready_file import add_next_ask, owns_permission
from yui_notify.hook.event import parse_event
from yui_notify.hook.focus import host_app_in_front
from yui_notify.hook.wait import wait_for_answer
from yui_notify.host.label import context
from yui_notify.threads.body import build_thread, thread_id
from yui_notify.threads.check import probe_failure
from yui_notify.threads.client import put


def run_hook(env: Mapping[str, str], stdin: TextIO) -> None:
    try:
        event = parse_event(json.load(stdin), env)
    except ValueError:
        return
    if event is None:
        return
    if owns_permission(event, env):
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
    add_next_ask(body, event, env)
    status, _, error = put(url, body)
    if error:
        config.write_error(env, url, status, error)
        return
    if event.agent == "codex" and body.get("ask"):
        cap = cfg["wait"]["stop" if event.phase == "Stop" else "permission"]
        output = wait_for_answer(url, body, event.phase, cap, env)
        if output:
            print(json.dumps(output))
