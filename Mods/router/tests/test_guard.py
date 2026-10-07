"""Host/Origin guard — the router refuses DNS-rebound browser requests before proxying."""

import httpx
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from router import server

LOOPBACK = "http://127.0.0.1:8080"


def test_foreign_host_is_refused_with_421():
    assert TestClient(server.app).get("/_mods", headers={"host": "evil.example"}).status_code == 421


def test_foreign_origin_is_refused_with_403():
    r = TestClient(server.app, base_url=LOOPBACK).get(
        "/_mods", headers={"origin": "http://evil.example:8080"}
    )
    assert r.status_code == 403


def test_loopback_host_passes():
    assert TestClient(server.app).get("/_mods", headers={"host": "localhost:8080"}).status_code == 200


def test_foreign_host_never_reaches_the_upstream(monkeypatch):
    hits = []

    async def record(request):
        hits.append(request.url.path)
        return PlainTextResponse("ok")

    upstream = Starlette(routes=[Route("/{p:path}", record, methods=["POST"])])
    transport = httpx.ASGITransport(app=upstream)
    monkeypatch.setitem(server.UPSTREAMS, "echo", "http://up")
    monkeypatch.setattr(server, "_client", lambda: httpx.AsyncClient(transport=transport, timeout=None))
    r = TestClient(server.app).post("/echo/mcp", content="hello", headers={"host": "evil.example"})
    assert r.status_code == 421
    assert hits == []


def test_unparsable_host_or_origin_is_refused():
    client = TestClient(server.app, raise_server_exceptions=False)
    assert client.get("/_mods", headers={"host": "[::1"}).status_code == 421
    assert client.get("/_mods", headers={"host": "127.0.0.1:8080", "origin": "http://[x"}).status_code == 403
