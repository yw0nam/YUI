from __future__ import annotations

from collections.abc import Mapping
from typing import Callable

from yui_notify.host import command


def host_app_in_front(
    env: Mapping[str, str], run: Callable[[list[str], float], str | None] = command.run
) -> bool:
    # macOS hands each app's bundle id to the processes it launches; a remote host cannot see local focus,
    # and a tmux pane keeps the bundle id of the app that started the tmux server
    host = env.get("__CFBundleIdentifier")
    if not host or env.get("SSH_CONNECTION") or env.get("TMUX"):
        return False
    front = run(["lsappinfo", "front"], 1)
    if not front:
        return False
    return run(["lsappinfo", "info", "-only", "bundleid", front], 1) == f'"CFBundleIdentifier"="{host}"'
