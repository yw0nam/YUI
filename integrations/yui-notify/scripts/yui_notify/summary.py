from __future__ import annotations

import os
import shutil
import subprocess
from typing import Callable

MAX = 1500
PROMPT = "Summarize in one English sentence what the coding agent reported. Output only the sentence."

# each agent's flags turn its own hooks off for the nested run
COMMANDS = {
    "claude-code": lambda model: [
        "claude",
        "-p",
        "--model",
        model,
        "--no-session-persistence",
        "--settings",
        '{"disableAllHooks":true}',
        PROMPT,
    ],
    "codex": lambda model: [
        "codex",
        "exec",
        "-m",
        model,
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "--color",
        "never",
        "--disable",
        "hooks",
        PROMPT,
    ],
}


def _run(cmd: list[str], text: str) -> str | None:
    # YUI_NOTIFY_CHILD stops managed hooks that outlive the disable flags
    env = {**os.environ, "YUI_NOTIFY_CHILD": "1"}
    try:
        out = subprocess.run(
            cmd, check=False, input=text, capture_output=True, text=True, timeout=60, env=env
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout if out.returncode == 0 else None


def _excerpt(message: str) -> str:
    # head+tail keeps a long report's opening and result when no model writes a summary
    return message[:740] + "\n…\n" + message[-740:]


def summarize(
    message: str,
    agent: str,
    models: dict | None,
    run: Callable[[list[str], str], str | None] = _run,
    which: Callable[[str], str | None] = shutil.which,
) -> str:
    if len(message) <= MAX:
        return message
    model = models.get(agent) if isinstance(models, dict) else None
    build = COMMANDS.get(agent)
    if not model or build is None or which(build(model)[0]) is None:
        return _excerpt(message)
    return (run(build(model), message) or "").strip()[:MAX] or _excerpt(message)
