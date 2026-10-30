import pytest


@pytest.fixture(autouse=True)
def isolated_claude_environment(monkeypatch):
    monkeypatch.delenv("CLAUDE_CODE_MESSAGING_SOCKET", raising=False)
    monkeypatch.delenv("CLAUDE_PID", raising=False)


@pytest.mark.parametrize(
    "argv,ready",
    [
        (["claude"], False),
        (["claude", "plugin:yui-notify@yui"], False),
        (["claude", "--channels", "plugin:other@test"], False),
        (["claude", "--channels", "plugin:other@test", "plugin:yui-notify@yui"], True),
        (["claude", "--dangerously-load-development-channels", "plugin:yui-notify@yui"], True),
        (["claude", "--channels", "plugin:other@test", "--prompt", "plugin:yui-notify@yui"], False),
        (["claude", "--channels", "plugin:yui-notify@yui", "plugin:other@test"], True),
    ],
)
def test_discover_parent_and_readiness(argv, ready):
    from channel.identity import discover

    table = {30: (20, ["uv", "run"]), 20: (10, ["/usr/local/bin/" + argv[0], *argv[1:]])}
    identity = discover(30, table.__getitem__)
    assert (identity.pid, identity.ready) == (20, ready)


def test_discover_stops_after_five_parents():
    from channel.identity import discover

    seen = []

    def process(pid):
        seen.append(pid)
        return pid - 1, ["uv"]

    with pytest.raises(ValueError, match="claude process not found within 5 parents"):
        discover(30, process)
    assert seen == [30, 29, 28, 27, 26]


@pytest.mark.parametrize("flag", ["--channels", "--dangerously-load-development-channels"])
@pytest.mark.parametrize("separator", [" ", "="])
def test_discover_ps_output_with_apostrophe(monkeypatch, flag, separator):
    from types import SimpleNamespace

    from channel.identity import discover

    monkeypatch.delenv("CLAUDE_CODE_MESSAGING_SOCKET", raising=False)
    monkeypatch.delenv("CLAUDE_PID", raising=False)
    monkeypatch.setattr(
        "subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(
            stdout=f"10 /usr/bin/claude {flag}{separator}plugin:yui-notify@yui don't stop"
        ),
    )
    try:
        identity = discover(20)
        actual = identity.pid, identity.ready
    except ValueError:
        actual = None
    assert actual == (20, True)


@pytest.mark.parametrize("source", ["socket", "node"])
def test_discover_socket_or_node_parent(monkeypatch, source):
    from types import SimpleNamespace

    from channel.identity import discover

    monkeypatch.delenv("CLAUDE_PID", raising=False)
    monkeypatch.setattr("os.getppid", lambda: 30)
    monkeypatch.setenv("CLAUDE_CODE_MESSAGING_SOCKET", "/tmp/cc-socks/80.sock" if source == "socket" else "")
    table = {
        30: "20 uv run python server.py",
        20: "1 node /opt/npm/claude --channels plugin:yui-notify@yui" if source == "node" else "1 codex",
        80: "1 claude --channels plugin:yui-notify@yui",
    }
    monkeypatch.setattr("subprocess.run", lambda args, **kwargs: SimpleNamespace(stdout=table[int(args[-1])]))
    try:
        identity = discover()
        actual = identity.pid, identity.ready
    except ValueError:
        actual = None
    assert actual == ((80, True) if source == "socket" else (20, True))
