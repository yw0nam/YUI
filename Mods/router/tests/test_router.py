"""Unit tests for the Mods router — a language-agnostic reverse proxy fronting mod ports."""

import httpx
import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from router import server


class TestResolve:
    def test_maps_known_mod_to_base_and_rest(self):
        assert server.resolve("desktop/mcp") == ("http://127.0.0.1:9000", "mcp")

    def test_shell_sandbox_is_registered(self):
        assert server.resolve("shell/mcp") == ("http://127.0.0.1:9001", "mcp")

    def test_avatar_is_registered(self):
        assert server.resolve("avatar/mcp") == ("http://127.0.0.1:9002", "mcp")

    def test_unknown_mod_returns_none(self):
        assert server.resolve("nope/mcp") is None


class TestListMods:
    def test_upstream_is_the_internal_address(self):
        by_name = {m["mod_name"]: m["upstream"] for m in server.list_mods()}
        assert by_name["desktop"] == "http://127.0.0.1:9000"
        assert by_name["shell"] == "http://127.0.0.1:9001"

    def test_endpoint_is_the_agent_facing_router_path(self):
        by_name = {m["mod_name"]: m["endpoint"] for m in server.list_mods()}
        assert by_name["shell"] == "/shell/mcp"  # relative when no base given

    def test_endpoint_uses_request_base_url(self):
        by_name = {m["mod_name"]: m["endpoint"] for m in server.list_mods("http://host:8080/")}
        assert by_name["desktop"] == "http://host:8080/desktop/mcp"

    def test_record_shape(self):
        for m in server.list_mods():
            assert set(m) == {"mod_name", "endpoint", "upstream"}

    def test_mods_endpoint_returns_json_with_request_base(self):
        r = TestClient(server.app).get("/_mods")
        assert r.status_code == 200
        shell = next(m for m in r.json() if m["mod_name"] == "shell")
        assert shell["endpoint"].endswith("/shell/mcp")
        assert shell["endpoint"].startswith("http://")  # absolute, from the request
        assert shell["upstream"] == "http://127.0.0.1:9001"


def _fake_upstream():
    async def echo(request):
        body = await request.body()
        return PlainTextResponse(
            f"{request.method} /{request.path_params['p']} {body.decode()}",
            status_code=201,
        )

    return Starlette(routes=[Route("/{p:path}", echo, methods=["GET", "POST"])])


class TestProxy:
    @pytest.fixture
    def client(self, monkeypatch):
        transport = httpx.ASGITransport(app=_fake_upstream())
        monkeypatch.setitem(server.UPSTREAMS, "echo", "http://up")
        monkeypatch.setattr(server, "_client", lambda: httpx.AsyncClient(transport=transport, timeout=None))
        return TestClient(server.app)

    def test_forwards_path_method_body_to_upstream(self, client):
        r = client.post("/echo/mcp", content="hello")
        assert r.status_code == 201
        assert r.text == "POST /mcp hello"

    def test_unknown_mod_returns_404(self, client):
        assert client.get("/missing/mcp").status_code == 404

    def test_unreachable_upstream_returns_502(self, monkeypatch):
        monkeypatch.setitem(server.UPSTREAMS, "down", "http://127.0.0.1:1")

        async def fake_send(*a, **k):
            raise httpx.ConnectError("refused")

        client = httpx.AsyncClient()
        monkeypatch.setattr(client, "send", fake_send)
        monkeypatch.setattr(server, "_client", lambda: client)
        assert TestClient(server.app).get("/down/mcp").status_code == 502
