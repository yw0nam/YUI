from __future__ import annotations

import os
import subprocess
from collections.abc import Mapping
from pathlib import Path


def read_process(pid: int) -> tuple[int, list[str]]:
    result = subprocess.run(
        ["ps", "-ww", "-o", "ppid=,command=", "-p", str(pid)],
        capture_output=True,
        text=True,
        timeout=2,
        check=True,
    )
    parent, command = result.stdout.strip().split(None, 1)
    return int(parent), command.split()


def is_claude(argv: list[str]) -> bool:
    return bool(argv) and (Path(argv[0]).name == "claude" or any(arg.endswith("/claude") for arg in argv))


def claude_pid(
    env: Mapping[str, str], parent: int | None = None, process=read_process, *, hook: bool = False
) -> int | None:
    socket = Path(env.get("CLAUDE_CODE_MESSAGING_SOCKET", "")).name
    if socket.endswith(".sock") and socket[:-5].isdigit() and int(socket[:-5]) > 0:
        return int(socket[:-5])
    if hook and env.get("CLAUDE_PID", "").isdigit() and int(env["CLAUDE_PID"]) > 0:
        return int(env["CLAUDE_PID"])
    parent = os.getppid() if parent is None else parent
    pid = parent
    try:
        for _ in range(5):
            next_pid, argv = process(pid)
            if is_claude(argv):
                return pid
            if next_pid <= 1:
                break
            pid = next_pid
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return parent if hook else None
