"""Unit tests for the Mods router — a language-agnostic reverse proxy fronting mod ports."""

import httpx
import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server import router


class TestResolve:
    def test_maps_known_mod_to_base_and_rest(self):
        assert router.resolve("desktop/mcp") == ("http://127.0.0.1:9000", "mcp")

    def test_shell_sandbox_is_registered(self):
        assert router.resolve("shell/mcp") == ("http://127.0.0.1:9001", "mcp")

    def test_unknown_mod_returns_none(self):
        assert router.resolve("nope/mcp") is None


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
        monkeypatch.setitem(router.UPSTREAMS, "echo", "http://up")
        monkeypatch.setattr(
            router, "_client", lambda: httpx.AsyncClient(transport=transport, timeout=None)
        )
        return TestClient(router.app)

    def test_forwards_path_method_body_to_upstream(self, client):
        r = client.post("/echo/mcp", content="hello")
        assert r.status_code == 201
        assert r.text == "POST /mcp hello"

    def test_unknown_mod_returns_404(self, client):
        assert client.get("/missing/mcp").status_code == 404

    def test_unreachable_upstream_returns_502(self, monkeypatch):
        monkeypatch.setitem(router.UPSTREAMS, "down", "http://127.0.0.1:1")

        async def fake_send(*a, **k):
            raise httpx.ConnectError("refused")

        client = httpx.AsyncClient()
        monkeypatch.setattr(client, "send", fake_send)
        monkeypatch.setattr(router, "_client", lambda: client)
        assert TestClient(router.app).get("/down/mcp").status_code == 502
