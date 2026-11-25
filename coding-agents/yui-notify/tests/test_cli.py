import io
import json
import os
import socket
from pathlib import Path

import pytest

from yui_notify.cli import main

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).parent / "fixtures"


# Claude Code's messaging socket path, which the hook reads the pid from; never connected
MESSAGING_SOCKET = {"CLAUDE_CODE_MESSAGING_SOCKET": "/tmp/yui-notify-tests/8864.sock"}
PERMISSION_TEXT = "Bash:\n```\ntouch /Users/dev/projects/demo/hello.txt\n```"


def run_hook(tmp_path, endpoint, fixture, config=None, extra_env=None, **updates):
    cfg_dir = tmp_path / "cfg" / "yui-notify"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (cfg_dir / "config.json").write_text(json.dumps({"endpoint": endpoint, **(config or {})}))
    env = {
        "CLAUDECODE": "1",
        "CLAUDE_PID": "8864",
        "XDG_CONFIG_HOME": str(tmp_path / "cfg"),
        "XDG_STATE_HOME": str(tmp_path / "state"),
        **(extra_env or {}),
    }
    data = json.loads((FIXTURES / fixture).read_text())
    if fixture.startswith("codex"):
        data["transcript_path"] = str(FIXTURES / "codex-rollout-cli.jsonl")
    data.update(updates)
    return main(["hook"], stdin=io.StringIO(json.dumps(data)), env=env)


@pytest.mark.parametrize(
    "fixture,state,role,text",
    [
        ("claude-stop.json", "completed", "agent", None),
        ("claude-permission.json", "input-required", "system", PERMISSION_TEXT),
        (
            "claude-notification.json",
            "input-required",
            "system",
            "The github MCP server is asking for your input",
        ),
        ("claude-user-prompt.json", "working", "user", "Please fix the upload client."),
        ("claude-session-end.json", "completed", "system", "Session ended"),
        ("codex-user-prompt.json", "working", "user", "Please fix the upload client."),
        ("codex-stop.json", "completed", "agent", None),
        ("codex-permission.json", "input-required", "system", "Bash:\n```\nrm -rf build\n```"),
        ("codex-session-end.json", "completed", "system", "Session ended"),
    ],
)
def test_hook_posts_thread(tmp_path, server, fixture, state, role, text):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, fixture) == 0
    data = json.loads((FIXTURES / fixture).read_text())
    agent = "codex" if fixture.startswith("codex") else "claude-code"
    path, body = received[0]
    assert (
        path
        == f"/threads/{agent}:{socket.gethostname().split('.')[0]}:{data['session_id'] if agent == 'codex' else '8864'}"
    )
    assert body == {
        "source": agent,
        "title": "demo",
        "label": None,
        "state": state,
        "entries": [{"role": role, "text": text or data["last_assistant_message"]}],
    }


@pytest.mark.parametrize("text", ["x" * 16385, "😀" * 16384])
def test_entry_and_body_budget(tmp_path, server, text):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-stop.json", last_assistant_message=text)
    body = received[0][1]
    entry = body["entries"][0]["text"]
    assert len(entry) <= 16384
    assert len(json.dumps(body, ensure_ascii=False).encode()) <= 65536
    assert entry.endswith("…")
    assert text.startswith(entry[:-1])


def test_session_start_warns_only_when_unreachable(tmp_path, server, capsys):
    endpoint, received = server
    received.status[1] = 405
    run_hook(tmp_path, endpoint, "claude-session-start.json")
    assert received.polls == ["/threads/yui-notify-probe"]
    assert capsys.readouterr().out == ""
    run_hook(tmp_path, "http://127.0.0.1:1", "claude-session-start.json")
    assert json.loads(capsys.readouterr().out) == {
        "systemMessage": "yui-notify: YUI is not listening at http://127.0.0.1:1/threads/yui-notify-probe (External signals off, wrong port, or no tunnel)"
    }


def test_unreachable_endpoint_exits_zero_and_records_error(tmp_path):
    assert run_hook(tmp_path, "http://127.0.0.1:1", "claude-stop.json") == 0
    err = json.loads((tmp_path / "state" / "yui-notify" / "last-error.json").read_text())
    assert "/threads/claude-code:" in err["url"]
    assert err["status"] is None
    assert err["error"]


@pytest.mark.parametrize(
    "command,status,line",
    [
        ("probe", 503, "unexpected HTTP 503 from {url}"),
        ("test", 404, "unknown or invalid thread id: {url}"),
    ],
)
def test_probe_and_test_report(tmp_path, server, capsys, command, status, line):
    endpoint, received = server
    received.status[:] = [status, status]
    assert main([command, "--endpoint", endpoint], env={"XDG_CONFIG_HOME": str(tmp_path)}) == 1
    path = (
        "/threads/yui-notify-probe"
        if command == "probe"
        else f"/threads/yui-notify:test:{socket.gethostname().split('.')[0]}"
    )
    assert capsys.readouterr().out == line.format(url=endpoint + path) + "\n"


@pytest.mark.parametrize(
    "status,code,line",
    [
        (405, 0, "ok: YUI is listening at {url}"),
        (400, 1, "update YUI: Threads are not supported at {url}"),
        (404, 1, "update YUI: Threads are not supported at {url}"),
    ],
    ids=["listening", "old-yui", "no-threads-route"],
)
def test_probe_reports_a_threads_listener(tmp_path, server, capsys, status, code, line):
    endpoint, received = server
    received.status[1] = status
    assert main(["probe", "--endpoint", endpoint], env={"XDG_CONFIG_HOME": str(tmp_path)}) == code
    assert capsys.readouterr().out == line.format(url=endpoint + "/threads/yui-notify-probe") + "\n"
    assert received.polls == ["/threads/yui-notify-probe"]


def test_probe_with_nothing_listening_reports_the_unreachable_line(tmp_path, capsys):
    assert main(["probe", "--endpoint", "http://127.0.0.1:1"], env={"XDG_CONFIG_HOME": str(tmp_path)}) == 1
    out = capsys.readouterr().out
    assert out.startswith("YUI is not listening at http://127.0.0.1:1/threads/yui-notify-probe")
    assert out.endswith(" (External signals off, wrong port, or no tunnel)\n")


def test_the_test_command_posts_one_input_required_thread(tmp_path, server, capsys):
    endpoint, received = server
    assert main(["test", "--endpoint", endpoint], env={"XDG_CONFIG_HOME": str(tmp_path)}) == 0
    assert capsys.readouterr().out == "sent: HTTP 200; look for it in YUI's Threads window\n"
    assert len(received) == 1
    path, body = received[0]
    assert path == f"/threads/yui-notify:test:{socket.gethostname().split('.')[0]}"
    assert body == {
        "source": "yui-notify",
        "title": os.path.basename(os.getcwd()),
        "state": "input-required",
        "entries": [
            {
                "role": "system",
                "text": "Test Thread from the yui-notify setup. Mark it read in YUI's Threads window.",
            }
        ],
    }
    assert received.polls == []


def test_claude_id_falls_back_to_parent_pid(tmp_path, server, monkeypatch):
    endpoint, received = server
    monkeypatch.setattr("os.getppid", lambda: 9000)
    run_hook(tmp_path, endpoint, "claude-stop.json", extra_env={"CLAUDE_PID": ""})
    assert received[0][0] == f"/threads/claude-code:{socket.gethostname().split('.')[0]}:9000"


@pytest.mark.parametrize(
    "fixture,env,rollout",
    [
        ("claude-user-prompt.json", {"CLAUDE_CODE_ENTRYPOINT": "sdk-cli"}, None),
        ("codex-user-prompt.json", {}, "codex-rollout-exec.jsonl"),
        ("codex-user-prompt.json", {}, "codex-rollout-subagent.jsonl"),
    ],
)
def test_noninteractive_prompt_posts_nothing(tmp_path, server, fixture, env, rollout):
    endpoint, received = server
    updates = {"transcript_path": str(FIXTURES / rollout)} if rollout else {}
    run_hook(tmp_path, endpoint, fixture, extra_env=env, **updates)
    assert received == []


@pytest.mark.parametrize("path", ["/presets/demo", "/threads", "/"])
def test_probe_rejects_endpoint_path(tmp_path, server, capsys, path):
    endpoint, received = server
    url = endpoint + path
    assert main(["probe", "--endpoint", url], env={"XDG_CONFIG_HOME": str(tmp_path)}) == 1
    assert capsys.readouterr().out == f"invalid endpoint: use http://127.0.0.1:<port> with no path: {url}\n"
    assert received.polls == []


def test_claude_hook_socket_pid_overrides_inherited_pid(tmp_path, server):
    endpoint, received = server
    run_hook(
        tmp_path,
        endpoint,
        "claude-stop.json",
        extra_env={"CLAUDE_CODE_MESSAGING_SOCKET": "/tmp/yui-notify-tests/80.sock"},
    )
    assert received[0][0] == f"/threads/claude-code:{socket.gethostname().split('.')[0]}:80"


@pytest.mark.parametrize("fixture", ["claude-task-notification.json", "claude-agent-message.json"])
def test_queued_prompt_moves_the_thread_without_an_entry(tmp_path, server, fixture):
    endpoint, received = server
    run_hook(tmp_path, endpoint, fixture)
    body = received[0][1]
    assert (body["state"], body["entries"]) == ("working", [])
    assert "ask" not in body


def permission_marker(tmp_path):
    return tmp_path / "state" / "yui-notify" / "bc68d697-4e8f-4be0-8ea6-e67f955b2586.permission.json"


def test_claude_permission_posts_input_required_and_returns_at_once(tmp_path, server):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, "claude-permission.json") == 0
    assert len(received) == 1
    path, body = received[0]
    assert path == f"/threads/claude-code:{socket.gethostname().split('.')[0]}:8864"
    assert body == {
        "source": "claude-code",
        "title": "demo",
        "label": None,
        "state": "input-required",
        "entries": [{"role": "system", "text": PERMISSION_TEXT}],
    }
    assert received.polls == []
    assert permission_marker(tmp_path).exists()


@pytest.mark.parametrize("hook", ["PostToolUse", "PostToolUseFailure"])
def test_the_allowed_tool_returns_the_thread_to_working(tmp_path, server, hook):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-permission.json")
    assert permission_marker(tmp_path).exists(), "the permission hook wrote no marker"
    run_hook(tmp_path, endpoint, "claude-permission.json", hook_event_name=hook)
    assert len(received) == 2
    assert received[1][0] == received[0][0]
    assert received[1][1] == {**received[0][1], "state": "working", "entries": []}
    assert "ask" not in received[1][1]
    assert not permission_marker(tmp_path).exists()


def test_a_tool_run_with_no_marker_sends_nothing(tmp_path, server):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-permission.json", hook_event_name="PostToolUse")
    assert received == []


@pytest.mark.parametrize(
    "updates",
    [{"tool_name": "Edit"}, {"tool_input": {"command": "rm -rf build"}}],
    ids=["other-tool", "other-input"],
)
def test_a_tool_run_that_matches_no_marker_sends_nothing(tmp_path, server, updates):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-permission.json")
    run_hook(tmp_path, endpoint, "claude-permission.json", hook_event_name="PostToolUse", **updates)
    assert len(received) == 1


def test_claude_stop_drops_the_permission_marker_before_its_put(tmp_path, server):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, "claude-permission.json") == 0
    run_hook(tmp_path, endpoint, "claude-stop.json")
    run_hook(tmp_path, endpoint, "claude-permission.json", hook_event_name="PostToolUse")
    assert not permission_marker(tmp_path).exists()
    assert len(received) == 2


def test_claude_stop_posts_completed_with_a_messaging_socket(tmp_path, server):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, "claude-stop.json", extra_env=MESSAGING_SOCKET) == 0
    assert len(received) == 1
    _, body = received[0]
    assert body["state"] == "completed"
    assert "ask" not in body
    assert received.polls == []


def test_codex_permission_posts_input_required_and_returns_at_once(tmp_path, server):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, "codex-permission.json") == 0
    assert len(received) == 1
    _, body = received[0]
    assert body["state"] == "input-required"
    assert "ask" not in body
    assert received.polls == []
