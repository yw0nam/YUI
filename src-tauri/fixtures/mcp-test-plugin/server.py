"""MCP test server for the host's tests: newline-delimited JSON-RPC over stdio, stdlib only."""

import json
import os
import subprocess
import sys
import threading
import time

MODE = os.environ.get("FIXTURE_MODE", "")
out_lock = threading.Lock()

TOOLS = [
    {
        "name": "echo_args",
        "description": "Returns argv and FIXTURE_DATA.",
        "inputSchema": {"type": "object"},
        "_meta": {"io.github.yw0nam.yui/summary": "Echo argv."},
    },
    {
        "name": "echo_meta",
        "description": "Returns the _meta it received.",
        "inputSchema": {"type": "object"},
    },
    {
        "name": "slow",
        "description": "Sleeps 30 s.",
        "inputSchema": {"type": "object"},
        "_meta": {"io.github.yw0nam.yui/wait_ms": 1500},
    },
    {
        "name": "spawn_child",
        "description": "Starts sleep 300 and returns its pid.",
        "inputSchema": {"type": "object"},
    },
    {
        "name": "look",
        "description": "Collides with a built-in client tool.",
        "inputSchema": {"type": "object"},
    },
]


def send(message):
    with out_lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()


def log(line):
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


def text(value):
    return {"content": [{"type": "text", "text": json.dumps(value)}], "isError": False}


def call(request_id, params):
    name = params.get("name")
    if name == "echo_args":
        result = text({"argv": sys.argv, "data": os.environ.get("FIXTURE_DATA")})
    elif name == "echo_meta":
        result = text(params.get("_meta"))
    elif name == "slow":
        time.sleep(30)
        result = text("slept")
    elif name == "spawn_child":
        result = text(subprocess.Popen(["sleep", "300"]).pid)
    elif name == "look":
        result = text("looked")
    else:
        send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "unknown tool"}})
        return
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def main():
    if MODE == "hang":
        log(f"child pid={subprocess.Popen(['sleep', '300']).pid}")
    if MODE == "noisy":
        for n in range(50):
            log(f"noise {n}")
        sys.stderr.write("x" * 100_000)
        sys.stderr.flush()
    for line in sys.stdin:
        message = json.loads(line)
        method = message.get("method")
        request_id = message.get("id")
        if method == "initialize":
            if MODE == "hang":
                continue
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "yui-test", "version": "0.1.0"},
                },
            })
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}})
            if MODE == "exit":
                for n in range(3):
                    log(f"exiting {n}")
                sys.exit(3)
        elif method == "tools/call":
            threading.Thread(target=call, args=(request_id, message.get("params", {})), daemon=True).start()
        elif method == "notifications/cancelled":
            log(f"cancelled id={message['params'].get('requestId')}")
        elif request_id is not None:
            send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "method not found"}})
    if MODE == "linger":
        time.sleep(30)


main()
