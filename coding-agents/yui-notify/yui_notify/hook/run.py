from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.hook.event import parse_event
from yui_notify.hook.focus import host_app_in_front
from yui_notify.hook.wait import wait_for_answer
from yui_notify.host.claude_pid import SOCKET_ENV, claude_pid
from yui_notify.host.label import context
from yui_notify.inbox.post import post
from yui_notify.inbox.spawn import spawn
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
    cfg = config.load(env)
    if event.phase == "SessionStart":
        failure = probe_failure(cfg["endpoint"])
        if failure:
            print(json.dumps({"systemMessage": f"yui-notify: {failure}"}))
        return
    url = cfg["endpoint"] + "/threads/" + thread_id(event, env)
    front = event.agent == "codex" and event.phase == "PermissionRequest" and host_app_in_front(env)
    body = build_thread(event, context(event.cwd, env), front, bool(env.get(SOCKET_ENV)))
    status, _, error = put(url, body)
    if error:
        config.write_error(env, url, status, error)
        return
    ask = body.get("ask")
    if not ask:
        return
    if event.agent == "claude-code" and event.phase == "Stop":
        spawn(url, ask["ask_id"], claude_pid(env, hook=True), env)
        return
    cap = cfg["wait"]["stop" if event.phase == "Stop" else "permission"]
    output = wait_for_answer(url, body, event.phase, cap, env)
    if output:
        print(json.dumps(output))
        decision = output.get("hookSpecificOutput", {}).get("decision", {})
        if event.agent == "claude-code" and decision.get("message"):
            post(decision["message"], env)
