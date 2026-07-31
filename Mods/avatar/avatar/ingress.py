"""HTTP client for the YUI client's loopback avatar ingress.

The YUI app owns the avatar: this module only speaks to it. Every failure mode the
agent can act on is translated into an `IngressError` with a plain-language reason —
the app is not running, the window did not answer, the request was rejected.
"""

import json
import os
import urllib.error
import urllib.request
from typing import Any

INGRESS_URL_ENV = "AVATAR_INGRESS_URL"
# The YUI client's stored default agent-ingress port.
DEFAULT_INGRESS_URL = "http://127.0.0.1:8770"

# Read-only queries answer immediately; a command runs a real gesture. Both sit above
# the client's own deadlines (2s / 15s) so its 503 arrives instead of a client-side cutoff.
QUERY_TIMEOUT_S = 5.0
COMMAND_TIMEOUT_S = 20.0


class IngressError(RuntimeError):
    """The avatar ingress could not serve the request."""


def base_url() -> str:
    """Ingress base URL from env, defaulting to the client's stored ingress port."""
    return os.getenv(INGRESS_URL_ENV, DEFAULT_INGRESS_URL).rstrip("/")


def _request(method: str, path: str, payload: dict[str, Any] | None, timeout: float) -> Any:
    url = f"{base_url()}{path}"
    data = None if payload is None else json.dumps(payload).encode()
    headers = {} if data is None else {"Content-Type": "application/json"}
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode()
    except urllib.error.HTTPError as err:
        if err.code == 503:
            raise IngressError(
                "The YUI window did not answer in time. It may be busy loading or unresponsive."
            ) from err
        raise IngressError(f"The YUI app rejected the request (HTTP {err.code}): {method} {path}") from err
    except (urllib.error.URLError, OSError) as err:
        raise IngressError(
            f"The YUI app is not running or is not reachable at {base_url()}. "
            f"Start YUI (with the agent ingress enabled), or set {INGRESS_URL_ENV}."
        ) from err
    try:
        return json.loads(body)
    except json.JSONDecodeError as err:
        raise IngressError(f"The YUI app returned a non-JSON body for {method} {path}.") from err


def query(path: str) -> Any:
    """GET a read-only avatar endpoint."""
    return _request("GET", path, None, QUERY_TIMEOUT_S)


def command(payload: dict[str, Any]) -> Any:
    """POST one movement command and return its result."""
    return _request("POST", "/avatar/command", payload, COMMAND_TIMEOUT_S)
