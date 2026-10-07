"""Host/Origin guard — refuses browser requests whose hostname was rebound to loopback."""

from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import PlainTextResponse

LOOPBACK_NAMES = {"127.0.0.1", "localhost", "::1"}


def is_loopback_host(hostport: str) -> bool:
    """True when `host[:port]` (or `[v6]:port`) names a loopback host."""
    return urlsplit(f"//{hostport}").hostname in LOOPBACK_NAMES


def _refusal(headers: Headers) -> PlainTextResponse | None:
    if not is_loopback_host(headers.get("host", "")):
        return PlainTextResponse("Misdirected Request", status_code=421)
    origin = headers.get("origin")
    if origin is not None and urlsplit(origin).hostname not in LOOPBACK_NAMES:
        return PlainTextResponse("Forbidden Origin", status_code=403)
    return None


class HostOriginGuard:
    """Pure ASGI middleware: foreign Host -> 421, foreign Origin -> 403, else the app."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        refusal = _refusal(Headers(scope=scope)) if scope["type"] == "http" else None
        if refusal is None:
            await self.app(scope, receive, send)
        else:
            await refusal(scope, receive, send)
