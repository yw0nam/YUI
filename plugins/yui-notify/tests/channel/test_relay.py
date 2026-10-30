import asyncio
import json

import pytest


@pytest.mark.parametrize("preview", ["ls", "😀" * 16384])
def test_permission_request_posts_ask(monkeypatch, preview):
    from yui_notify.channel.relay import PermissionRequest, relay

    posted = []

    def put(url, body):
        posted.append((url, body))
        return 200, None, None

    monkeypatch.setattr("yui_notify.channel.relay.put", put)
    asyncio.run(
        relay(
            "http://localhost:8770/threads/claude-code:host:20",
            {"project": "demo", "branch": None, "host": None, "tmux": None},
            PermissionRequest(
                request_id="r1", tool_name="Bash", description="Run command", input_preview=preview
            ),
        )
    )
    url, body = posted[0]
    assert url == "http://localhost:8770/threads/claude-code:host:20"
    entry = body.pop("entries")[0]
    assert entry["role"] == "system"
    assert entry["text"] == "Bash: Run command\nls" if preview == "ls" else entry["text"].endswith("…")
    assert len(entry["text"]) <= 16384
    assert len(json.dumps({**body, "entries": [entry]}, ensure_ascii=False).encode()) <= 65536
    assert body == {
        "source": "claude-code",
        "title": "demo",
        "label": "demo",
        "state": "input-required",
        "ask": {
            "ask_id": "perm:r1",
            "prompt": "Allow Bash?",
            "choices": [
                {"id": "allow", "label": "Allow", "tone": "primary"},
                {"id": "deny", "label": "Deny", "tone": "danger"},
            ],
            "text": True,
            "placeholder": "Or tell Claude what to do instead",
        },
    }


def test_permission_put_failure_records_error(tmp_path, monkeypatch):
    from yui_notify.channel.relay import PermissionRequest, relay

    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    monkeypatch.setattr("yui_notify.channel.relay.put", lambda *args: (503, None, "HTTP 503 Unavailable"))
    asyncio.run(
        relay(
            "http://localhost/threads/t",
            {"project": "demo", "branch": None, "host": None, "tmux": None},
            PermissionRequest(request_id="r1", tool_name="Bash", description="Run", input_preview="ls"),
        )
    )
    path = tmp_path / "yui-notify" / "last-error.json"
    assert path.exists() is True
    recorded = json.loads(path.read_text())
    recorded.pop("time")
    assert recorded == {"url": "http://localhost/threads/t", "status": 503, "error": "HTTP 503 Unavailable"}
