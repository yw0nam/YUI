"""Host/Origin guard on the HTTP transport — refuses DNS-rebound browser requests."""

import sys

from starlette.testclient import TestClient

from desktop_control import server

LOOPBACK = "127.0.0.1:9000"
INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "t", "version": "0"},
    },
}


def _post(app, **headers):
    with TestClient(app) as client:
        return client.post(
            "/mcp", json=INITIALIZE, headers={"accept": "application/json, text/event-stream", **headers}
        )


def _guarded():
    return server.mcp.http_app(transport="http", host_origin_protection=True)


def test_foreign_host_is_refused_with_421():
    assert _post(_guarded(), host="evil.example").status_code == 421


def test_foreign_origin_is_refused_with_403():
    assert _post(_guarded(), host=LOOPBACK, origin="http://evil.example:9000").status_code == 403


def test_request_without_browser_headers_reaches_the_server():
    assert _post(_guarded(), host=LOOPBACK).status_code not in (421, 403)


def test_default_app_lets_a_foreign_host_through():
    assert _post(server.mcp.http_app(transport="http"), host="evil.example").status_code not in (421, 403)


def test_main_enables_the_guard_for_http_only(monkeypatch):
    calls = []
    monkeypatch.setattr(server.mcp, "run", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(server, "preflight", lambda: None)
    for transport in ("http", "stdio"):
        monkeypatch.setattr(sys, "argv", ["desktop-control-mcp", "--transport", transport])
        server.main()
    assert calls[0]["host_origin_protection"] is True
    assert "host_origin_protection" not in calls[1]
