import asyncio
import contextlib
import os
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("ready", [True, False])
def test_runtime_only_ready_server_polls_and_marks(tmp_path, monkeypatch, ready):
    from channel import runtime

    calls = []
    path = tmp_path / "yui-notify" / "channels" / "20"

    @contextlib.asynccontextmanager
    async def stdio():
        yield "read", "write"

    async def serve_loop(server, read, write, **kwargs):
        assert (read, write) == ("read", "write")
        assert path.exists() is ready
        await asyncio.sleep(0.02)
        calls.append("served")

    async def poll(url, write):
        assert path.read_text() == str(os.getpid())
        calls.append((url, write))
        await asyncio.Event().wait()

    monkeypatch.setattr(runtime, "stdio_server", stdio)
    monkeypatch.setattr(runtime, "serve_loop", serve_loop)
    monkeypatch.setattr(runtime, "poll", poll)
    identity = SimpleNamespace(pid=20, ready=ready, thread_id="claude-code:host:20")
    server = SimpleNamespace(create_initialization_options=lambda **kwargs: kwargs)
    asyncio.run(runtime.serve(server, identity, {"XDG_STATE_HOME": str(tmp_path)}))
    assert calls == (
        [("http://127.0.0.1:8770/threads/claude-code:host:20", "write"), "served"] if ready else ["served"]
    )
    assert path.exists() is False


@pytest.mark.parametrize("found", [False, True])
def test_unavailable_channel_serves_idle(tmp_path, monkeypatch, capsys, found):
    from mcp.server.lowlevel import Server
    from channel import runtime
    from channel.identity import Identity

    served = []
    server = Server("test")
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))

    def discover():
        if not found:
            raise ValueError("claude process not found within 5 parents")
        return Identity(20, False)

    @contextlib.asynccontextmanager
    async def stdio():
        yield "read", "write"

    async def serve_loop(*args, **kwargs):
        served.append(True)

    async def poll(*args):
        pytest.fail("idle server consumes no answers")

    monkeypatch.setattr(runtime, "discover", discover)
    monkeypatch.setattr(runtime, "stdio_server", stdio)
    monkeypatch.setattr(runtime, "serve_loop", serve_loop)
    monkeypatch.setattr(runtime, "poll", poll)
    code = 0
    try:
        asyncio.run(runtime.main(server))
    except SystemExit as error:
        code = error.code
    assert code == 0
    assert served == [True]
    assert list(tmp_path.rglob("channels/*")) == []
    assert server.get_notification_handler("notifications/claude/channel/permission_request") is None
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == (
        "yui-notify: Claude Code channel not enabled; channel idle\n"
        if found
        else "yui-notify: claude process not found; channel idle\n"
    )
