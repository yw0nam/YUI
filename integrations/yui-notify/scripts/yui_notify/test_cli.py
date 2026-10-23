import http.server
import io
import json
import threading
from pathlib import Path

import pytest

from yui_notify.cli import main

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def server():
    received = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            received.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}", received
    httpd.shutdown()


def run_hook(tmp_path, endpoint, fixture, config=None, extra_env=None):
    (tmp_path / "cfg" / "yui-notify").mkdir(parents=True, exist_ok=True)
    cfg = {"endpoint": endpoint, "summary": None}
    cfg.update(config or {})
    (tmp_path / "cfg" / "yui-notify" / "config.json").write_text(json.dumps(cfg))
    env = {
        "CLAUDECODE": "1",
        "XDG_CONFIG_HOME": str(tmp_path / "cfg"),
        "XDG_STATE_HOME": str(tmp_path / "state"),
    }
    env.update(extra_env or {})
    return main(["hook"], stdin=io.StringIO((FIXTURES / fixture).read_text()), env=env)


def test_stop_posts_done_signal(tmp_path, server):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, "claude-stop.json") == 0
    path, body = received[0]
    assert path == "/signals"
    envelope = body["envelope"]
    assert isinstance(envelope.pop("occurred_at"), int)
    assert envelope == {
        "source": "claude-code",
        "event_type": "agent.done",
        "delivery": "batched",
        "event_id": "bc68d697-4e8f-4be0-8ea6-e67f955b2586:done",
        "label": "demo",
    }
    item = body["signals"][0]
    assert item["project"] == "demo"
    assert item["summary"].startswith("I couldn't create the file.")
    assert item["summary"].endswith("for a reason.")


def test_permission_posts_urgent_pending(tmp_path, server):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-permission.json")
    body = received[0][1]
    assert body["envelope"]["event_type"] == "agent.needs_input"
    assert body["envelope"]["delivery"] == "urgent"
    assert body["signals"][0]["pending"] == "Bash: touch /Users/dev/projects/demo/hello.txt"


def test_notification_posts_message_as_pending(tmp_path, server):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-notification.json")
    assert received[0][1]["signals"][0]["pending"] == "The github MCP server is asking for your input"
    assert received[0][1]["envelope"]["delivery"] == "urgent"


def test_drop_posts_nothing(tmp_path, server):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-stop.json", {"events": {"done": "drop"}})
    assert received == []


def test_child_posts_nothing(tmp_path, server):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-stop.json", extra_env={"YUI_NOTIFY_CHILD": "1"})
    assert received == []


def test_unreachable_endpoint_exits_zero_and_records_error(tmp_path):
    assert run_hook(tmp_path, "http://127.0.0.1:1", "claude-stop.json") == 0
    err = json.loads((tmp_path / "state" / "yui-notify" / "last-error.json").read_text())
    assert err["url"] == "http://127.0.0.1:1/signals"
    assert err["status"] is None
    assert err["error"]
