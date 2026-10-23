import http.server
import io
import json
import threading
from pathlib import Path

import pytest

from yui_notify.cli import main

FIXTURES = Path(__file__).parent / "fixtures"
CLAUDE_STOP_TEXT = (
    "I couldn't create the file. The Bash `touch` was blocked because Claude Code asks for approval "
    "before a shell command creates files in this working directory, and this session can't show that "
    "prompt. The file `hello.txt` does not exist yet.\n\nTo finish, approve the `touch` command when it "
    "prompts, or allow Bash writes to this directory, then I can run it again. I didn't use another "
    "tool to create the file, since you asked for Bash specifically and the approval gate is there "
    "for a reason."
)


class Received(list):
    status: list


@pytest.fixture
def server():
    received = Received()
    status = [200]

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            received.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            self.send_response(status[0])
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    received.status = status
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


@pytest.mark.parametrize(
    "fixture, event_type, delivery, event_id, item_key, item_value",
    [
        (
            "claude-stop.json",
            "agent.done",
            "batched",
            "bc68d697-4e8f-4be0-8ea6-e67f955b2586:done",
            "summary",
            CLAUDE_STOP_TEXT,
        ),
        (
            "claude-permission.json",
            "agent.needs_input",
            "urgent",
            "bc68d697-4e8f-4be0-8ea6-e67f955b2586:needs_input",
            "pending",
            "Bash: touch /Users/dev/projects/demo/hello.txt",
        ),
        (
            "claude-notification.json",
            "agent.needs_input",
            "urgent",
            "bc68d697-4e8f-4be0-8ea6-e67f955b2586:needs_input",
            "pending",
            "The github MCP server is asking for your input",
        ),
    ],
    ids=["stop", "permission", "notification-synthetic"],
)
def test_hook_posts_signal(tmp_path, server, fixture, event_type, delivery, event_id, item_key, item_value):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, fixture) == 0
    path, body = received[0]
    assert path == "/signals"
    assert isinstance(body["envelope"].pop("occurred_at"), int)
    assert body["envelope"] == {
        "source": "claude-code",
        "event_type": event_type,
        "delivery": delivery,
        "event_id": event_id,
        "label": "demo",
    }
    assert body["signals"] == [
        {"project": "demo", "branch": None, "host": None, "tmux": None, item_key: item_value}
    ]


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


@pytest.mark.parametrize(
    "command, status, line, code",
    [
        ("probe", 200, "ok: YUI is listening at {url}", 0),
        ("probe", 404, "no such preset: {url}", 1),
        ("probe", 503, "the preset's pet window is closed: {url}", 1),
        ("probe", 400, "unexpected HTTP 400 from {url}", 1),
        ("probe", None, "YUI is not listening at {url} (External signals off, wrong port, or no tunnel)", 1),
        ("test", 200, "sent: HTTP 200", 0),
        ("test", 503, "the preset's pet window is closed: {url}", 1),
    ],
)
def test_probe_and_test_report(tmp_path, server, capsys, command, status, line, code):
    endpoint, received = server
    if status is None:
        endpoint = "http://127.0.0.1:1"
    else:
        received.status[0] = status
    assert main([command, "--endpoint", endpoint], env={"XDG_CONFIG_HOME": str(tmp_path)}) == code
    assert capsys.readouterr().out == line.format(url=endpoint + "/signals") + "\n"
    if command == "probe" and status is not None:
        assert received[0] == ("/signals", {"signals": [], "envelope": "yui-notify-probe"})
