from __future__ import annotations

import os
import socket
from collections.abc import Mapping
from typing import Any, Callable

from yui_notify import command


def context(
    cwd: str,
    env: Mapping[str, str],
    run: Callable[[list[str], float], str | None] = command.run,
    hostname: Callable[[], str] = socket.gethostname,
) -> dict:
    tmux = None
    if env.get("TMUX"):
        tmux = run(["tmux", "display-message", "-p", "-t", env.get("TMUX_PANE", ""), "#S:#I"], 1)
    return {
        "project": os.path.basename(cwd.rstrip("/")),
        "branch": run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], 1),
        "host": hostname().split(".")[0] if env.get("SSH_CONNECTION") else None,
        "tmux": tmux,
    }


def make_label(ctx: Mapping[str, Any]) -> str:
    project = f"{ctx['project']} ({ctx['branch']})" if ctx["branch"] else ctx["project"]
    parts = [ctx["host"], f"tmux {ctx['tmux']}" if ctx["tmux"] else None, project]
    return " · ".join(p for p in parts if p)
