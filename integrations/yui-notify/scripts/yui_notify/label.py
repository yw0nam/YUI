from __future__ import annotations

import os
import socket
import subprocess
from collections.abc import Mapping
from typing import Any, Callable


def _run(cmd: list[str], timeout: float) -> str | None:
    try:
        out = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


def context(
    cwd: str,
    env: Mapping[str, str],
    run: Callable[[list[str], float], str | None] = _run,
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
