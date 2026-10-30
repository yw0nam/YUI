import io
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest

from yui_notify.cli import main

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).parent / "fixtures"


INBOX = {"CLAUDE_CODE_MESSAGING_SOCKET": "/tmp/cc-socks/8864.sock"}  # named, never connected


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
    "fixture,state,role,text,ask",
    [
        ("claude-stop.json", "input-required", "agent", None, "next"),
        (
            "claude-permission.json",
            "input-required",
            "system",
            "Bash: touch /Users/dev/projects/demo/hello.txt",
            "claude-perm",
        ),
        (
            "claude-notification.json",
            "input-required",
            "system",
            "The github MCP server is asking for your input",
            "absent",
        ),
        ("claude-user-prompt.json", "working", "user", "Please fix the upload client.", None),
        ("claude-session-end.json", "completed", "system", "Session ended", None),
        ("codex-user-prompt.json", "working", "user", "Please fix the upload client.", None),
        ("codex-stop.json", "input-required", "agent", None, "stop"),
        ("codex-permission.json", "input-required", "system", "Bash: rm -rf build", "perm"),
        ("codex-session-end.json", "completed", "system", "Session ended", None),
    ],
)
def test_hook_posts_thread(tmp_path, server, fixture, state, role, text, ask):
    endpoint, received = server
    assert run_hook(tmp_path, endpoint, fixture, extra_env=INBOX) == 0
    data = json.loads((FIXTURES / fixture).read_text())
    agent = "codex" if fixture.startswith("codex") else "claude-code"
    path, body = received[0]
    assert (
        path
        == f"/threads/{agent}:{socket.gethostname().split('.')[0]}:{data['session_id'] if agent == 'codex' else '8864'}"
    )
    expected = {
        "source": agent,
        "title": "demo",
        "label": "demo",
        "state": state,
        "entries": [{"role": role, "text": text or data["last_assistant_message"]}],
    }
    if ask == "next":
        actual = body["ask"]
        assert actual["ask_id"].startswith("next:") and len(actual["ask_id"]) == 5 + 32
        expected["ask"] = {
            "ask_id": actual["ask_id"],
            "prompt": "What next?",
            "text": True,
            "placeholder": "Next instruction",
        }
    elif ask in ("stop", "perm", "claude-perm"):
        actual = body["ask"]
        if ask == "claude-perm":
            assert re.fullmatch(r"perm:[0-9a-f]{32}", actual["ask_id"])
        else:
            assert actual["ask_id"].startswith(f"{ask}:{data['turn_id']}:")
            assert len(actual["ask_id"].rsplit(":", 1)[1]) == 32
        agent_name = "Claude" if ask == "claude-perm" else "Codex"
        expected["ask"] = {
            "ask_id": actual["ask_id"],
            "prompt": "What next?" if ask == "stop" else "Allow Bash?",
            "text": True,
            "placeholder": "Next instruction"
            if ask == "stop"
            else f"Or tell {agent_name} what to do instead",
        }
        if ask != "stop":
            expected["ask"]["choices"] = [
                {"id": "allow", "label": "Allow", "tone": "primary"},
                {"id": "deny", "label": "Deny", "tone": "danger"},
            ]
    elif ask != "absent":
        expected["ask"] = None
    assert body == expected


def test_inbox_answer_is_not_posted_again(tmp_path, server):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-inbox-prompt.json")
    body = received[0][1]
    assert body["state"] == "working"
    assert body["entries"] == []
    assert body["ask"] is None


@pytest.mark.parametrize(
    "fixture,answer,expected",
    [
        (
            "codex-permission.json",
            {"choice": "allow"},
            {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}},
        ),
        (
            "codex-permission.json",
            {"choice": "deny", "text": "Use read only"},
            {
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {"behavior": "deny", "message": "Use read only"},
                }
            },
        ),
        (
            "codex-permission.json",
            {"text": "Run tests instead"},
            {
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {"behavior": "deny", "message": "Run tests instead"},
                }
            },
        ),
        (
            "codex-stop.json",
            {"text": "Continue with tests"},
            {"decision": "block", "reason": "Continue with tests"},
        ),
    ],
)
def test_codex_answers(tmp_path, server, capsys, fixture, answer, expected):
    endpoint, received = server
    received.answer = answer
    run_hook(tmp_path, endpoint, fixture)
    out = capsys.readouterr().out
    assert (json.loads(out) if out else None) == expected
    assert parse_qs(urlparse(received.polls[0]).query)["ask_id"] == [received[0][1]["ask"]["ask_id"]]
    if fixture == "codex-stop.json":
        assert parse_qs(urlparse(received.polls[0]).query)["wait"] == ["25"]


@pytest.mark.parametrize(
    "fixture,state,status",
    [
        ("codex-stop.json", "completed", 410),
        ("codex-permission.json", "working", 503),
        ("codex-stop.json", "completed", 204),
        ("codex-permission.json", "working", 0),
        ("codex-stop.json", "completed", -1),
        ("codex-stop.json", "completed", 200),
        ("codex-permission.json", "working", 200),
    ],
)
def test_codex_fallback_closes_ask(tmp_path, server, capsys, monkeypatch, fixture, state, status):
    endpoint, received = server
    received.status[1] = status
    ticks = iter([0, 0, 600])
    monkeypatch.setattr("time.monotonic", lambda: next(ticks))
    run_hook(tmp_path, endpoint, fixture)
    assert capsys.readouterr().out == ""
    assert len(received) == 2
    assert received[-1][1] == {**received[0][1], "state": state, "ask": None, "entries": []}


def test_successive_stops_can_both_be_answered(tmp_path, server, capsys):
    endpoint, received = server
    received.answer = {"text": "Continue"}
    for active in (False, True):
        run_hook(tmp_path, endpoint, "codex-stop.json", stop_hook_active=active)
        assert json.loads(capsys.readouterr().out) == {"decision": "block", "reason": "Continue"}
    ids = [body["ask"]["ask_id"] for _, body in received]
    assert len(set(ids)) == 2


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
    received.status[1] = 404
    run_hook(tmp_path, endpoint, "claude-session-start.json")
    assert received.polls == ["/threads/yui-notify-probe/answer?ask_id=probe&wait=0"]
    assert capsys.readouterr().out == ""
    run_hook(tmp_path, "http://127.0.0.1:1", "claude-session-start.json")
    assert json.loads(capsys.readouterr().out) == {
        "systemMessage": "yui-notify: YUI is not listening at http://127.0.0.1:1/threads/yui-notify-probe/answer?ask_id=probe&wait=0 (External signals off, wrong port, or no tunnel)"
    }


def test_unreachable_endpoint_exits_zero_and_records_error(tmp_path):
    assert run_hook(tmp_path, "http://127.0.0.1:1", "claude-stop.json") == 0
    err = json.loads((tmp_path / "state" / "yui-notify" / "last-error.json").read_text())
    assert "/threads/claude-code:" in err["url"]
    assert err["status"] is None
    assert err["error"]


@pytest.mark.parametrize(
    "command,status,line,code",
    [
        ("probe", 404, "ok: YUI is listening at {url}", 0),
        ("probe", 400, "update YUI: Threads are not supported at {url}", 1),
        ("probe", 503, "YUI is busy: every answer wait is in use: {url}", 1),
        ("probe", None, "YUI is not listening at {url} (External signals off, wrong port, or no tunnel)", 1),
        ("test", 404, "unknown or invalid thread id: {url}", 1),
        (
            "test",
            200,
            "sent: HTTP 200; answer it in YUI's Threads window within 60 s\nanswered: Arrived",
            0,
        ),
        ("test", 503, "YUI is busy: every answer wait is in use: {url}", 1),
    ],
)
def test_probe_and_test_report(tmp_path, server, capsys, command, status, line, code):
    endpoint, received = server
    if status is None:
        endpoint = "http://127.0.0.1:1"
    else:
        received.status[:] = [status, status]
    received.answer = {"choice": "arrived"}
    assert main([command, "--endpoint", endpoint], env={"XDG_CONFIG_HOME": str(tmp_path)}) == code
    path = (
        "/threads/yui-notify-probe/answer?ask_id=probe&wait=0"
        if command == "probe"
        else f"/threads/yui-notify:test:{socket.gethostname().split('.')[0]}"
    )
    assert capsys.readouterr().out == line.format(url=endpoint + path) + "\n"
    if command == "test":
        assert received[0][0] == path
        assert received[0][1]["state"] == "input-required"
        assert received[0][1]["ask"]["ask_id"].startswith("test:")
        assert received[0][1]["entries"] == [
            {"role": "system", "text": "Test Thread from the yui-notify setup."}
        ]
        if code == 0:
            assert parse_qs(urlparse(received.polls[0]).query)["ask_id"] == [received[0][1]["ask"]["ask_id"]]
            assert received[-1][1]["state"] == "completed"
            assert received[-1][1]["ask"] is None


def test_test_without_answer_closes_the_thread(tmp_path, server, capsys, monkeypatch):
    endpoint, received = server
    received.status[1] = 204
    ticks = iter([0, 0, 600])
    monkeypatch.setattr("time.monotonic", lambda: next(ticks))
    assert main(["test", "--endpoint", endpoint], env={"XDG_CONFIG_HOME": str(tmp_path)}) == 1
    assert capsys.readouterr().out == (
        "sent: HTTP 200; answer it in YUI's Threads window within 60 s\nno answer within 60 s\n"
    )
    assert len(received) == 2
    assert received[-1][1] == {**received[0][1], "state": "completed", "ask": None, "entries": []}


def test_claude_id_falls_back_to_parent_pid(tmp_path, server, monkeypatch):
    endpoint, received = server
    monkeypatch.setattr("os.getppid", lambda: 9000)
    run_hook(tmp_path, endpoint, "claude-stop.json", extra_env={"CLAUDE_PID": ""})
    assert received[0][0] == f"/threads/claude-code:{socket.gethostname().split('.')[0]}:9000"


BLOCK = '{"decision": "block", "reason": "Continue"}\n'
DENY = (
    '{"hookSpecificOutput": {"hookEventName": "PermissionRequest", '
    '"decision": {"behavior": "deny", "message": "Continue"}}}\n'
)


@pytest.mark.parametrize(
    "fixture,waits,output",
    [
        ("claude-stop.json", False, ""),
        ("claude-permission.json", True, DENY),
        ("codex-stop.json", True, BLOCK),
        ("codex-permission.json", False, ""),
    ],
)
def test_focus_posts_and_only_codex_permission_skips_wait(
    tmp_path, server, capsys, monkeypatch, fixture, waits, output
):
    endpoint, received = server
    received.answer = {"text": "Continue"}
    calls = []

    def focus(env):
        calls.append(True)
        return True

    monkeypatch.setattr("yui_notify.hook.run.host_app_in_front", focus)
    run_hook(tmp_path, endpoint, fixture, extra_env=INBOX)
    assert calls == ([True] if fixture == "codex-permission.json" else [])
    assert len(received) == 1
    assert bool(received.polls) == waits
    if fixture == "codex-permission.json":
        assert "ask" not in received[0][1]
    assert capsys.readouterr().out == output


def test_bounded_poll_timeout(tmp_path, server, monkeypatch):
    import urllib.request

    endpoint, received = server
    received.answer = {"choice": "allow"}
    timeouts = []
    open_url = urllib.request.urlopen

    def capture(req, timeout):
        timeouts.append(timeout)
        return open_url(req, timeout=timeout)

    monkeypatch.setattr(urllib.request, "urlopen", capture)
    ticks = iter([0, 2.1])
    monkeypatch.setattr("time.monotonic", lambda: next(ticks))
    run_hook(tmp_path, endpoint, "codex-permission.json", {"wait": {"permission": 10}})
    assert parse_qs(urlparse(received.polls[0]).query)["wait"] == ["7"]
    assert timeouts == [2, 12]


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


def test_claude_stop_posts_the_ask_and_hands_the_wait_to_a_poller(tmp_path, server, capsys, spawned):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-stop.json", extra_env=INBOX)
    path, body = received[0]
    ask = body["ask"]
    assert body["state"] == "input-required"
    assert str(UUID(ask["ask_id"].removeprefix("next:"))).replace("-", "") == ask["ask_id"][5:]
    assert ask == {
        "ask_id": ask["ask_id"],
        "prompt": "What next?",
        "text": True,
        "placeholder": "Next instruction",
    }
    assert received.polls == []
    assert capsys.readouterr().out == ""
    assert spawned == [(endpoint + path, ask["ask_id"], 8864)]


def test_claude_stop_without_an_inbox_completes_without_an_ask(tmp_path, server, capsys, spawned):
    endpoint, received = server
    run_hook(tmp_path, endpoint, "claude-stop.json")
    body = received[0][1]
    assert (body["state"], body["ask"]) == ("completed", None)
    assert received.polls == []
    assert capsys.readouterr().out == ""
    assert spawned == []


@pytest.mark.parametrize(
    "answer,output,posted",
    [
        (
            {"text": "use the other file"},
            {
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {"behavior": "deny", "message": "use the other file"},
                }
            },
            ["use the other file"],
        ),
        (
            {"choice": "allow"},
            {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}},
            [],
        ),
    ],
)
def test_claude_permission_answer_applies_and_text_reaches_the_inbox(
    tmp_path, server, capsys, monkeypatch, answer, output, posted
):
    endpoint, received = server
    received.answer = answer
    sent = []
    monkeypatch.setattr("yui_notify.hook.run.post", lambda text, env: sent.append(text))
    run_hook(tmp_path, endpoint, "claude-permission.json", extra_env=INBOX)
    assert json.loads(capsys.readouterr().out) == output
    assert sent == posted


def test_claude_hook_socket_pid_overrides_inherited_pid(tmp_path, server):
    endpoint, received = server
    run_hook(
        tmp_path,
        endpoint,
        "claude-stop.json",
        extra_env={"CLAUDE_CODE_MESSAGING_SOCKET": "/tmp/cc-socks/80.sock"},
    )
    assert received[0][0] == f"/threads/claude-code:{socket.gethostname().split('.')[0]}:80"


def test_signalled_wait_closes_its_ask(tmp_path, server):
    endpoint, received = server
    received.status[1] = 204
    cfg_dir = tmp_path / "cfg" / "yui-notify"
    cfg_dir.mkdir(parents=True)
    (cfg_dir / "config.json").write_text(json.dumps({"endpoint": endpoint}))
    env = dict(
        os.environ,
        CLAUDECODE="1",
        CLAUDE_PID="8864",
        XDG_CONFIG_HOME=str(tmp_path / "cfg"),
        XDG_STATE_HOME=str(tmp_path / "state"),
    )
    env.pop("CLAUDE_CODE_MESSAGING_SOCKET", None)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    hook = subprocess.Popen(
        [sys.executable, str(PLUGIN_ROOT / "bin" / "yui-notify"), "hook"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    try:
        hook.stdin.write((FIXTURES / "claude-permission.json").read_bytes())
        hook.stdin.close()
        deadline = time.time() + 20
        while time.time() < deadline and not received.polls:
            time.sleep(0.05)
        assert received.polls != []
        started = time.time()
        hook.send_signal(signal.SIGTERM)
        try:
            hook.wait(timeout=1.4)
        except subprocess.TimeoutExpired:
            pass
        assert hook.returncode is not None
        assert time.time() - started < 1.4
        _, closing = received[-1]
        assert (closing["state"], closing["ask"]) == ("working", None)
    finally:
        hook.kill()
