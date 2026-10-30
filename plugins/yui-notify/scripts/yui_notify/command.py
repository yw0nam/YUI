from __future__ import annotations

import subprocess


def run(cmd: list[str], timeout: float) -> str | None:
    try:
        out = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None
