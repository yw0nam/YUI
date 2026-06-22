"""Mods router — one HTTP front door that path-routes to independent mod processes.

Each mod stays a standalone process on its own port (any language). The router
only forwards bytes by URL prefix, so a single SSH reverse tunnel exposes them all:
    http://host:8080/<mod>/mcp  ->  127.0.0.1:<mod port>/mcp
"""

import argparse

import httpx
from loguru import logger
from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

# mod name -> upstream base. Add a mod = add a line; the external port stays one.
UPSTREAMS = {
    "desktop": "http://127.0.0.1:9000",
    "shell": "http://127.0.0.1:9001",
}

# hop-by-hop / length headers: the server re-derives these, forwarding them double-encodes.
_DROP = {b"connection", b"keep-alive", b"transfer-encoding", b"content-length", b"content-encoding", b"host"}


def resolve(path: str) -> tuple[str, str] | None:
    """'<mod>/<rest>' -> (upstream base, rest). Unknown mod -> None."""
    mod, _, rest = path.partition("/")
    base = UPSTREAMS.get(mod)
    return None if base is None else (base, rest)


def list_mods(base_url: str = "") -> list[dict[str, str]]:
    """Registered mods as {mod_name, endpoint, upstream} records.

    `endpoint` is the agent-facing router path to attach as an MCP source
    (`base_url` + `/<mod>/mcp`, derived from the request so it reflects however the
    agent reached the router); `upstream` is the internal address the router
    forwards to (operator/debug only — not reachable by the remote agent).
    """
    base = base_url.rstrip("/")
    return [
        {"mod_name": name, "endpoint": f"{base}/{name}/mcp", "upstream": up} for name, up in UPSTREAMS.items()
    ]


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=None)  # MCP Streamable HTTP is SSE — no read timeout


def _filter(raw) -> list[tuple[bytes, bytes]]:
    return [(k, v) for k, v in raw if k.lower() not in _DROP]


async def proxy(request):
    path = request.path_params["path"]
    target = resolve(path)
    if target is None:
        logger.warning(f"⬅️ 404 unknown mod: {path!r}")
        return Response("unknown mod", status_code=404)
    base, rest = target
    logger.info(f"➡️ {request.method} /{path} → {base}/{rest}")

    client = _client()
    upstream = client.build_request(
        request.method,
        f"{base}/{rest}",
        headers=_filter(request.headers.raw),
        content=request.stream(),
        params=request.query_params,
    )
    try:
        # ponytail: connect-stage only. Once streaming starts the 200 + headers are
        # already sent, so a mid-stream ReadError can't become a 502 — let it propagate
        # (abnormal close, which the client retries > silent truncation that looks like clean EOF).
        up = await client.send(upstream, stream=True)  # stream=True: pass SSE through unbuffered
    except httpx.ConnectError:
        await client.aclose()
        logger.warning(f"⬅️ 502 mod unreachable: {base}")
        return Response(f"mod unreachable: {base}", status_code=502)
    logger.info(f"⬅️ {up.status_code} {base}/{rest}")
    return StreamingResponse(
        up.aiter_bytes(),
        status_code=up.status_code,
        headers={k.decode("latin-1"): v.decode("latin-1") for k, v in _filter(up.headers.raw)},
        background=BackgroundTask(_aclose, up, client),
    )


async def _aclose(up, client):
    await up.aclose()
    await client.aclose()


async def mods_catalog(request):
    """Router meta endpoint: the registered mods, not proxied to any upstream."""
    logger.info("🔍 _mods catalog")
    return JSONResponse(list_mods(str(request.base_url)))


# `/_mods` is matched before the catch-all; the leading underscore avoids colliding
# with a real mod prefix.
app = Starlette(
    routes=[
        Route("/_mods", mods_catalog, methods=["GET"]),
        Route("/{path:path}", proxy, methods=["GET", "POST", "DELETE"]),
    ]
)


def main():
    parser = argparse.ArgumentParser(description="Mods reverse-proxy router")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
