from __future__ import annotations

import json
import socket
from collections.abc import Mapping

from yui_notify import config
from yui_notify.host.claude_pid import SOCKET_ENV

PREFIX = "Reply from the user in YUI's Threads window:\n"


def _send(path: str, text: str, env: Mapping[str, str]) -> str | None:
    if not path:
        return f"{SOCKET_ENV} is not set"
    lines = [{"type": "user", "message": {"role": "user", "content": PREFIX + text}}]
    if env.get("CLAUDE_CODE_MESSAGING_TOKEN"):
        lines.insert(0, {"type": "auth", "token": env["CLAUDE_CODE_MESSAGING_TOKEN"]})
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(5)
            sock.connect(path)
            sock.sendall("".join(json.dumps(line) + "\n" for line in lines).encode())
    except OSError as e:
        return str(e)
    return None


def post(text: str, env: Mapping[str, str]) -> str | None:
    path = env.get(SOCKET_ENV, "")
    error = _send(path, text, env)
    if error:
        config.write_error(env, path or SOCKET_ENV, None, error)
    return error
