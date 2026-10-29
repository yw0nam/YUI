from __future__ import annotations

import os
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from yui_notify.adapters import Event
from yui_notify.thread import fit_entries, next_ask


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
        if path.exists() and path.read_text() == str(os.getpid()):
            path.unlink()


def add_next_ask(body: dict, event: Event, env: Mapping[str, str]) -> None:
    if (
        event.agent == "claude-code"
        and event.phase == "Stop"
        and live(int(env.get("CLAUDE_PID") or os.getppid()), env)
    ):
        body["state"] = "input-required"
        body["ask"] = next_ask("next:" + uuid4().hex)
        fit_entries(body)
