import http.server
import json
import os
import shutil
import socketserver
import tempfile
import threading
import time

import pytest


class Received(list):
    status: list
    answer: dict
    polls: list


@pytest.fixture
def server():
    received = Received()
    received.status = [200, 200]
    received.answer = {"release": True}
    received.polls = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_PUT(self):
            received.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            self.reply(received.status[0], {})

        def do_GET(self):
            received.polls.append(self.path)
            if received.status[1] == -1:
                self.send_response(200)
                self.send_header("Content-Length", "100")
                self.end_headers()
                self.wfile.write(b"{")
                self.close_connection = True
                return
            if received.status[1] == 0:
                self.connection.close()
                return
            self.reply(received.status[1], received.answer)

        def reply(self, status, data):
            raw = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass

    httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}", received
    httpd.shutdown()
    httpd.server_close()


class Inbox:
    def __init__(self, path):
        self.path = path
        self.lines = []

    def wait(self, count, timeout=10):
        deadline = time.time() + timeout
        while len(self.lines) < count and time.time() < deadline:
            time.sleep(0.02)
        return list(self.lines)


@pytest.fixture
def inbox():
    # a Unix socket path is limited to 104 bytes on macOS, so the directory is short
    directory = tempfile.mkdtemp(dir="/tmp")
    box = Inbox(os.path.join(directory, f"{os.getpid()}.sock"))

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            box.lines.extend(self.rfile.read().decode().splitlines())

    unix = socketserver.ThreadingUnixStreamServer(box.path, Handler)
    unix.daemon_threads = True
    threading.Thread(target=unix.serve_forever, daemon=True).start()
    yield box
    unix.shutdown()
    unix.server_close()
    shutil.rmtree(directory, ignore_errors=True)


@pytest.fixture(autouse=True)
def spawned(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "yui_notify.hook.run.spawn",
        lambda url, ask_id, pid, env: calls.append((url, ask_id, pid)),
    )
    return calls
