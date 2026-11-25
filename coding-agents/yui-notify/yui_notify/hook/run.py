from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TextIO

from yui_notify import config
from yui_notify.hook import permission_marker
from yui_notify.hook.event import parse_event
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
    cfg = config.load(env)
    if event.phase == "SessionStart":
        failure = probe_failure(cfg["endpoint"])
        if failure:
            print(json.dumps({"systemMessage": f"yui-notify: {failure}"}))
        return
    if event.phase in ("PostToolUse", "PostToolUseFailure"):
        permission_marker.close(env, event.session_id, event.tool_name, event.tool_input)
        return
    # a denied request's marker must not match a later identical tool call
    if event.agent == "claude-code" and event.phase in ("UserPromptSubmit", "Stop", "SessionEnd"):
        permission_marker.remove(env, event.session_id)
    url = cfg["endpoint"] + "/threads/" + thread_id(event, env)
    body = build_thread(event, context(event.cwd, env))
    status, _, error = put(url, body)
    if error:
        config.write_error(env, url, status, error)
        return
    if event.agent == "claude-code" and event.phase == "PermissionRequest":
        permission_marker.write(env, event.session_id, url, body, event.tool_name, event.tool_input)
