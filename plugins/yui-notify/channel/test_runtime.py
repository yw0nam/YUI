import asyncio
import contextlib
import os
import socket
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("ready", [True, False])
def test_runtime_only_ready_server_polls_and_marks(tmp_path, monkeypatch, ready):
    from mcp.server.lowlevel import Server

    from channel import runtime

    calls = []
    path = tmp_path / "yui-notify" / "channels" / "20"

    @contextlib.asynccontextmanager
    async def stdio():
        yield "read", "write"

    async def serve_loop(server, read, write, **kwargs):
        assert (read, write) == ("read", "write")
        assert path.exists() is False
        if ready:
            handler = server.get_notification_handler("notifications/initialized")
            await handler.handler(None, handler.params_type.model_validate({}))
            await polled.wait()
        calls.append("served")

    async def poll(url, write):
        assert path.read_text() == str(os.getpid())
        calls.append((url, write))
        polled.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(runtime, "stdio_server", stdio)
    monkeypatch.setattr(runtime, "serve_loop", serve_loop)
    monkeypatch.setattr(runtime, "poll", poll)
    identity = SimpleNamespace(pid=20, ready=ready, thread_id="claude-code:host:20")
    server = Server("test")

    async def exercise():
        nonlocal polled
        polled = asyncio.Event()
        await runtime.serve(server, identity, {"XDG_STATE_HOME": str(tmp_path)})

    polled = None
    asyncio.run(exercise())
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
    asyncio.run(runtime.main(server))
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


def test_poll_waits_for_initialized_notification(tmp_path, monkeypatch):
    import anyio
    from mcp.server.lowlevel import Server

    from channel import runtime
    from channel.identity import Identity

    server = Server("test")
    calls = []

    @contextlib.asynccontextmanager
    async def stdio():
        yield "read", "write"

    async def exercise():
        entered, initialized, polled = anyio.Event(), anyio.Event(), anyio.Event()

        async def serve_loop(*args, **kwargs):
            entered.set()
            await initialized.wait()
            handler = server.get_notification_handler("notifications/initialized")
            assert handler is not None
            await handler.handler(None, handler.params_type.model_validate({}))
            await polled.wait()

        async def poll(url, write):
            calls.append((url, write))
            polled.set()
            await anyio.Event().wait()

        monkeypatch.setattr(runtime, "serve_loop", serve_loop)
        monkeypatch.setattr(runtime, "poll", poll)
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(runtime.serve, server, Identity(20, True), {"XDG_STATE_HOME": str(tmp_path)})
            await entered.wait()
            await anyio.wait_all_tasks_blocked()
            assert calls == []
            initialized.set()

    monkeypatch.setattr(runtime, "stdio_server", stdio)
    anyio.run(exercise)
    assert calls == [
        (
            "http://127.0.0.1:8770/threads/claude-code:" + socket.gethostname().split(".")[0] + ":20",
            "write",
        )
    ]
