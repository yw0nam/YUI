from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def post(url: str, body: Any, timeout: float = 2) -> tuple[int | None, str | None]:
    """Return (status, error); status is None when no response came, error is None on 2xx."""
    req = urllib.request.Request(
        url, json.dumps(body, ensure_ascii=False).encode(), {"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, None
    except urllib.error.HTTPError as e:
        return e.code, f"HTTP {e.code} {e.reason}"
    except (OSError, ValueError) as e:
        return None, str(e)
