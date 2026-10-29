from __future__ import annotations

import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path

from yui_notify.thread import claude_thread_id


@dataclass(frozen=True)
class Identity:
    pid: int
    ready: bool

    @property
    def thread_id(self) -> str:
        return claude_thread_id(self.pid)


def _process(pid: int) -> tuple[int, list[str]]:
    result = subprocess.run(
        ["ps", "-ww", "-o", "ppid=,command=", "-p", str(pid)],
        capture_output=True,
        text=True,
        timeout=2,
        check=True,
    )
    parent, command = result.stdout.strip().split(None, 1)
    return int(parent), shlex.split(command)


def _ready(argv: list[str]) -> bool:
    channels = False
    for arg in argv[1:]:
        if arg.startswith("-"):
            channels = arg in ("--channels", "--dangerously-load-development-channels")
        elif channels and arg == "plugin:yui-notify@yui":
            return True
    return False


def discover(pid: int | None = None, process=_process) -> Identity:
    pid = os.getppid() if pid is None else pid
    try:
        for _ in range(5):
            parent, argv = process(pid)
            if argv and Path(argv[0]).name == "claude":
                return Identity(pid, _ready(argv))
            if parent <= 1:
                break
            pid = parent
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    raise ValueError("claude process not found within 5 parents")
