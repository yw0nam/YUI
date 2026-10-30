from __future__ import annotations

import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path

from yui_notify import config

BIN = Path(__file__).resolve().parents[2] / "bin" / "yui-notify"


def spawn(url: str, ask_id: str, pid: int, env: Mapping[str, str]) -> None:
    try:
        subprocess.Popen(
            [sys.executable, str(BIN), "inbox", url, ask_id, str(pid)],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=dict(env),
        )
    except OSError as e:
        config.write_error(env, url, None, str(e))
