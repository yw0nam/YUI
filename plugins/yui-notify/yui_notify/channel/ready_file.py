from __future__ import annotations

import os
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path

from yui_notify.hook.event import Event
from yui_notify.host.claude_pid import claude_pid


def _path(pid: int, env: Mapping[str, str]) -> Path:
    root = env.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    return Path(root) / "yui-notify" / "channels" / str(pid)


def live(pid: int, env: Mapping[str, str]) -> bool:
    try:
        server_pid = int(_path(pid, env).read_text())
        if server_pid <= 0:
            return False
        os.kill(server_pid, 0)
        return True
    except PermissionError:
        return True
    except (OSError, ValueError):
        return False


@contextmanager
def ready_file(pid: int, env: Mapping[str, str]):
    path = _path(pid, env)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(os.getpid()))
    try:
        yield
    finally:
        remove_ready_file(pid, env)


def remove_ready_file(pid: int, env: Mapping[str, str]) -> None:
    path = _path(pid, env)
    if path.exists() and path.read_text() == str(os.getpid()):
        path.unlink()


def ready(env: Mapping[str, str]) -> bool:
    return live(claude_pid(env, hook=True), env)


def owns_permission(event: Event, env: Mapping[str, str]) -> bool:
    return event.agent == "claude-code" and event.phase == "PermissionRequest" and ready(env)
