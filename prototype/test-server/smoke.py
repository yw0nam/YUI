# Raw JSON-RPC smoke driver for prototype/test-server/server.py.
# Speaks the MCP stdio wire by hand so the server's behavior (init, _meta echo, image
# content, cancellation timing) is checkable before the rmcp host exists.
#
#   uv run smoke.py [slow_secs_before_cancel]

import json
import os
import select
import signal
import subprocess
import sys
import time
from pathlib import Path

DIR = Path(__file__).resolve().parent


def main() -> None:
    cancel_after = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    # Own session/process group, so the final killpg takes down uv, python and the
    # grandchild `sleep` in one stroke.
    proc = subprocess.Popen(
        ["uv", "run", "--directory", str(DIR), "server.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert proc.stdin and proc.stdout
    fd = proc.stdout.fileno()
    buf = ""
    t0 = time.monotonic()

    def send(obj, note=""):
        line = json.dumps(obj, separators=(",", ":"))
        print(f"[{time.monotonic() - t0:7.3f}s] SEND {note} {line[:160]}")
        proc.stdin.write(line + "\n")
        proc.stdin.flush()

    def read_line(timeout):
        """One stdout line or None after `timeout` seconds; returns buffered partials too."""
        nonlocal buf
        deadline = time.monotonic() + timeout
        while "\n" not in buf:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            ready, _, _ = select.select([fd], [], [], left)
            if not ready:
                return None
            chunk = os.read(fd, 65536)
            if not chunk:
                return buf if buf else None
            buf += chunk.decode("utf-8", "replace")
        line, buf = buf.split("\n", 1)
        return line

    def recv_until(pred, timeout=30):
        while True:
            line = read_line(timeout)
            if line is None:
                raise RuntimeError("timed out or stdout closed waiting for message")
            msg = json.loads(line)
            if pred(msg):
                return msg

    send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {},
        "clientInfo": {"name": "smoke", "version": "0.0.1"}}}, "initialize")
    init = recv_until(lambda m: m.get("id") == 1)
    print(f"[{time.monotonic() - t0:7.3f}s] INIT negotiated protocolVersion="
          f"{init['result']['protocolVersion']} server={init['result']['serverInfo']}")
    send({"jsonrpc": "2.0", "method": "notifications/initialized"}, "initialized")

    send({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, "tools/list")
    tools = recv_until(lambda m: m.get("id") == 2)
    print(f"[{time.monotonic() - t0:7.3f}s] TOOLS {[t['name'] for t in tools['result']['tools']]}")

    send({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
        "name": "echo_meta",
        "arguments": {},
        "_meta": {"io.github.yw0nam.yui/preset": "smoke-preset"}}}, "tools/call echo_meta")
    meta = recv_until(lambda m: m.get("id") == 3)
    print(f"[{time.monotonic() - t0:7.3f}s] ECHO_META text={meta['result']['content'][0]['text']}")

    send({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
        "name": "snapshot", "arguments": {}}}, "tools/call snapshot")
    snap = recv_until(lambda m: m.get("id") == 4)
    kinds = [(c["type"], len(c.get("data", ""))) for c in snap["result"]["content"]]
    print(f"[{time.monotonic() - t0:7.3f}s] SNAPSHOT blocks={kinds}")

    send({"jsonrpc": "2.0", "id": 10, "method": "tools/call", "params": {
        "name": "slow", "arguments": {}}}, "tools/call slow")
    time.sleep(cancel_after)
    print(f"[{time.monotonic() - t0:7.3f}s] SENDING notifications/cancelled for id 10")
    send({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {
        "requestId": 10, "reason": "smoke cancel"}}, "cancel")
    # Anything the server writes back after the cancel (error response or nothing).
    while True:
        line = read_line(3)
        if line is None:
            break
        print(f"[{time.monotonic() - t0:7.3f}s] after cancel, got: {line[:200]}")

    # Grandchild survival check without a killpg: SIGKILL only the uv process.
    print(f"[{time.monotonic() - t0:7.3f}s] SIGKILL uv pid={proc.pid} only (no killpg)")
    proc.kill()
    proc.wait()
    time.sleep(0.5)
    survivors = subprocess.run(
        ["pgrep", "-f", f"{DIR}/server.py|sleep 300"], capture_output=True, text=True
    )
    print(f"[{time.monotonic() - t0:7.3f}s] survivors of direct kill: {survivors.stdout.strip() or 'none'}")
    os.killpg(proc.pid, signal.SIGKILL)  # final cleanup of anything left


if __name__ == "__main__":
    main()
