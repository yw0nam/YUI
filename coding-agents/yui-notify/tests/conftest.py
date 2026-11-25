import http.server
import json
import threading

import pytest


class Received(list):
    status: list
    polls: list


@pytest.fixture
def server():
    received = Received()
    received.status = [200, 200]
    received.polls = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_PUT(self):
            received.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            self.reply(received.status[0], {})

        def do_GET(self):
            received.polls.append(self.path)
            self.reply(received.status[1], {})

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
