from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass

from yui_notify.claude_process import claude_pid, read_process
from yui_notify.thread import claude_thread_id


@dataclass(frozen=True)
class Identity:
    pid: int
    ready: bool

    @property
    def thread_id(self) -> str:
        return claude_thread_id(self.pid)


def _ready(argv: list[str]) -> bool:
    channels = False
    for arg in argv[1:]:
        if arg.startswith("-"):
            flag, _, value = arg.partition("=")
            channels = flag in ("--channels", "--dangerously-load-development-channels")
            if channels and value == "plugin:yui-notify@yui":
                return True
        elif channels and arg == "plugin:yui-notify@yui":
            return True
    return False


def discover(pid: int | None = None, process=read_process) -> Identity:
    try:
        found = claude_pid(os.environ, pid, process)
        if found is not None:
            _, argv = process(found)
            return Identity(found, _ready(argv))
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    raise ValueError("claude process not found within 5 parents")
