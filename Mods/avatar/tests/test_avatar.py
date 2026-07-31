"""Unit tests for the avatar MCP tools — the YUI ingress is a stubbed local HTTP server."""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest
from fastmcp.exceptions import ToolError

from avatar import ingress, server

STATE = {
    "position": {"x": 100, "y": 200, "monitor": 0},
    "posture": {"state": "sitting", "perched_on": {"app": "Notes"}},
    "vrm": {"id": "carlotta", "label": "Carlotta"},
    "moving": False,
}

PERCH_TARGETS = {
    "windows": [{"app": "Notes", "title": "Shopping", "rect": {"x": 0, "y": 0, "width": 8, "height": 6}}],
    "edges": ["left", "right"],
}


class _Stub(BaseHTTPRequestHandler):
    """Answers the three avatar routes from the class-level script."""

    # (status, body) per route, plus the commands the server received. Class-level so a
    # test can rescript the stub without reaching into the handler instances.
    routes: ClassVar[dict[str, tuple[int, object]]] = {}
    received: ClassVar[list[dict]] = []

    def log_message(self, *args):  # keep the test output clean
        pass

    def _reply(self, path: str) -> None:
        status, body = self.routes.get(path, (404, {}))
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._reply(self.path)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        _Stub.received.append(json.loads(self.rfile.read(length) or b"{}"))
        self._reply(self.path)


@pytest.fixture
def stub(monkeypatch):
    """A live loopback ingress stub; `stub.script` sets the per-route answers."""
    _Stub.routes = {
        "/avatar/state": (200, STATE),
        "/avatar/perch-targets": (200, PERCH_TARGETS),
        "/avatar/command": (200, {"ok": True}),
    }
    _Stub.received = []
    httpd = HTTPServer(("127.0.0.1", 0), _Stub)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv(ingress.INGRESS_URL_ENV, f"http://127.0.0.1:{httpd.server_address[1]}")
    yield _Stub
    httpd.shutdown()
    httpd.server_close()


class TestBaseUrl:
    def test_defaults_to_the_client_ingress_port(self, monkeypatch):
        monkeypatch.delenv(ingress.INGRESS_URL_ENV, raising=False)
        assert ingress.base_url() == "http://127.0.0.1:8770"

    def test_env_overrides_and_strips_the_trailing_slash(self, monkeypatch):
        monkeypatch.setenv(ingress.INGRESS_URL_ENV, "http://127.0.0.1:9999/")
        assert ingress.base_url() == "http://127.0.0.1:9999"


class TestGetBodyState:
    def test_returns_the_client_state(self, stub):
        assert server.get_body_state() == STATE

    def test_reports_a_stopped_app_clearly(self, monkeypatch):
        monkeypatch.setenv(ingress.INGRESS_URL_ENV, "http://127.0.0.1:1")
        with pytest.raises(ToolError, match="not running"):
            server.get_body_state()

    def test_reports_an_unresponsive_window(self, stub):
        stub.routes["/avatar/state"] = (503, {})
        with pytest.raises(ToolError, match="did not answer"):
            server.get_body_state()


class TestListPerchTargets:
    def test_returns_the_client_candidates(self, stub):
        assert server.list_perch_targets() == PERCH_TARGETS


class TestSitOnWindow:
    def test_posts_the_named_app(self, stub):
        assert server.sit_on_window("Notes") == {"ok": True}
        assert stub.received == [{"action": "sit_on_window", "app": "Notes"}]

    def test_raises_with_the_client_reason(self, stub):
        stub.routes["/avatar/command"] = (200, {"ok": False, "reason": "not_found"})
        with pytest.raises(ToolError, match="not_found"):
            server.sit_on_window("Xcode")


class TestPeek:
    def test_posts_the_side(self, stub):
        assert server.peek("left") == {"ok": True}
        assert stub.received == [{"action": "peek", "side": "left"}]

    def test_rejects_an_unknown_side_without_calling(self, stub):
        with pytest.raises(ToolError, match="side"):
            server.peek("up")
        assert stub.received == []

    def test_raises_when_the_user_interrupts(self, stub):
        stub.routes["/avatar/command"] = (200, {"ok": False, "reason": "interrupted"})
        with pytest.raises(ToolError, match="interrupted"):
            server.peek("right")

    def test_raises_when_a_window_in_front_covers_the_seat(self, stub):
        stub.routes["/avatar/command"] = (200, {"ok": False, "reason": "blocked"})
        with pytest.raises(ToolError, match="blocked"):
            server.peek("left")


class TestMoveTo:
    def test_omits_the_monitor_when_not_given(self, stub):
        assert server.move_to("center") == {"ok": True}
        assert stub.received == [{"action": "move_to", "spot": "center"}]

    def test_includes_the_monitor_when_given(self, stub):
        server.move_to("top-left", monitor=1)
        assert stub.received == [{"action": "move_to", "spot": "top-left", "monitor": 1}]

    def test_rejects_an_unknown_spot_without_calling(self, stub):
        with pytest.raises(ToolError, match="spot"):
            server.move_to("middle")
        assert stub.received == []

    def test_raises_when_another_gesture_is_running(self, stub):
        stub.routes["/avatar/command"] = (200, {"ok": False, "reason": "busy"})
        with pytest.raises(ToolError, match="busy"):
            server.move_to("center")


class TestStandDown:
    def test_posts_the_verb(self, stub):
        assert server.stand_down() == {"ok": True}
        assert stub.received == [{"action": "stand_down"}]


class TestToolRegistration:
    def test_registers_the_six_avatar_tools(self):
        tools = asyncio.run(server.mcp.list_tools())
        names = {t.name for t in tools}
        assert {
            "get_body_state",
            "list_perch_targets",
            "sit_on_window",
            "peek",
            "move_to",
            "stand_down",
        } <= names

    def test_exposes_no_expression_or_screenshot_tools(self):
        """Expression stays on the generate_express stream; screens belong to desktop-control."""
        tools = asyncio.run(server.mcp.list_tools())
        names = {t.name for t in tools}
        assert not names & {"screenshot", "set_emotion", "play_motion", "speak"}
