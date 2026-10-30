import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "0"},
    },
}
INITIALIZED = {"jsonrpc": "2.0", "method": "notifications/initialized"}


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM])
def test_server_leaves_on_a_signal_and_removes_the_channel_file(tmp_path, signum):
    """SIGINT or SIGTERM ends the channel server at once and takes its channel file with it"""
    claude_script = tmp_path / "claude"
    claude_script.write_text("#!/bin/sh\nsleep 30\n")
    claude_script.chmod(0o755)
    claude = subprocess.Popen(
        [str(claude_script), "--dangerously-load-development-channels", "plugin:yui-notify@yui"]
    )
    env = dict(
        os.environ,
        XDG_STATE_HOME=str(tmp_path / "state"),
        CLAUDE_CODE_MESSAGING_SOCKET=f"/tmp/cc-socks/{claude.pid}.sock",
    )
    server = subprocess.Popen(
        [sys.executable, str(PLUGIN_ROOT / "channel" / "server.py")],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env=env,
    )
    channel_file = tmp_path / "state" / "yui-notify" / "channels" / str(claude.pid)
    try:
        server.stdin.write((json.dumps(INITIALIZE) + "\n" + json.dumps(INITIALIZED) + "\n").encode())
        server.stdin.flush()
        deadline = time.time() + 20
        while time.time() < deadline and not channel_file.exists():
            time.sleep(0.1)
        assert channel_file.exists() is True
        server.send_signal(signum)
        try:
            server.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        assert server.returncode == 0
        assert channel_file.exists() is False
    finally:
        server.kill()
        claude.kill()
