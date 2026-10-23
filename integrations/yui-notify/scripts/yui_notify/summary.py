from __future__ import annotations

import os
import shutil
import subprocess
from typing import Callable

MAX = 1500
PROMPT = "Summarize in one English sentence what the coding agent reported. Output only the sentence."


def _claude(cmd: list[str], text: str) -> str | None:
    # YUI_NOTIFY_CHILD stops the nested claude's own Stop hook from posting
    env = {**os.environ, "YUI_NOTIFY_CHILD": "1"}
    try:
        out = subprocess.run(
            cmd, check=False, input=text, capture_output=True, text=True, timeout=60, env=env
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout if out.returncode == 0 else None


def summarize(
    message: str,
    model: str | None,
    run: Callable[[list[str], str], str | None] = _claude,
    which: Callable[[str], str | None] = shutil.which,
) -> str:
    cut = message[:MAX]
    if not model or not message or not which("claude"):
        return cut
    out = run(["claude", "-p", "--model", model, "--no-session-persistence", PROMPT], message)
    return (out or "").strip()[:MAX] or cut
