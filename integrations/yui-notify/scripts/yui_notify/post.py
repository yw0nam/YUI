from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def _request(req: urllib.request.Request, timeout: float) -> tuple[int | None, Any, str | None]:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None, None
    except urllib.error.HTTPError as e:
        with e:
            return e.code, None, f"HTTP {e.code} {e.reason}"
    except (OSError, ValueError) as e:
        return None, None, str(e)


def put(url: str, body: Any) -> tuple[int | None, Any, str | None]:
    req = urllib.request.Request(
        url, json.dumps(body, ensure_ascii=False).encode(), {"Content-Type": "application/json"}, method="PUT"
    )
    return _request(req, 2)


def get(url: str, timeout: float) -> tuple[int | None, Any, str | None]:
    return _request(urllib.request.Request(url), timeout)
