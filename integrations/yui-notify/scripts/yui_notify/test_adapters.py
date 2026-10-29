import json
from pathlib import Path

import pytest

from yui_notify.adapters import parse_event

FIXTURES = Path(__file__).parent / "fixtures"
CLAUDE_STOP_TEXT = (
    "I couldn't create the file. The Bash `touch` was blocked because Claude Code asks for approval "
    "before a shell command creates files in this working directory, and this session can't show that "
    "prompt. The file `hello.txt` does not exist yet.\n\nTo finish, approve the `touch` command when it "
    "prompts, or allow Bash writes to this directory, then I can run it again. I didn't use another "
    "tool to create the file, since you asked for Bash specifically and the approval gate is there "
    "for a reason."
)
CLAUDE_ENV = {"CLAUDECODE": "1"}
CODEX_SESSION = "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61"
NO_ROLLOUT = object()


def load(fixture, rollout=NO_ROLLOUT):
    data = json.loads((FIXTURES / fixture).read_text())
    # the fixtures name their rollout file relative to the fixtures dir
    path = data["transcript_path"] if rollout is NO_ROLLOUT else rollout
    data["transcript_path"] = str(FIXTURES / path) if path else path
    return data


@pytest.mark.parametrize(
    "fixture, env, expected",
    [
        (
            "claude-stop.json",
            CLAUDE_ENV,
            ("claude-code", "Stop", "bc68d697-4e8f-4be0-8ea6-e67f955b2586", CLAUDE_STOP_TEXT),
        ),
        ("claude-stop-background.json", CLAUDE_ENV, None),
        ("claude-stop.json", {**CLAUDE_ENV, "CLAUDE_CODE_ENTRYPOINT": "sdk-cli"}, None),
        (
            "claude-stop.json",
            {**CLAUDE_ENV, "CLAUDE_CODE_ENTRYPOINT": "cli"},
            ("claude-code", "Stop", "bc68d697-4e8f-4be0-8ea6-e67f955b2586", CLAUDE_STOP_TEXT),
        ),
        (
            "claude-permission.json",
            {**CLAUDE_ENV, "CLAUDE_CODE_ENTRYPOINT": "sdk-cli"},
            (
                "claude-code",
                "PermissionRequest",
                "bc68d697-4e8f-4be0-8ea6-e67f955b2586",
                "Bash: touch /Users/dev/projects/demo/hello.txt",
            ),
        ),
        (
            "claude-permission.json",
            CLAUDE_ENV,
            (
                "claude-code",
                "PermissionRequest",
                "bc68d697-4e8f-4be0-8ea6-e67f955b2586",
                "Bash: touch /Users/dev/projects/demo/hello.txt",
            ),
        ),
        (
            "claude-notification.json",
            CLAUDE_ENV,
            (
                "claude-code",
                "Notification",
                "bc68d697-4e8f-4be0-8ea6-e67f955b2586",
                "The github MCP server is asking for your input",
            ),
        ),
        (
            "codex-stop.json",
            {},
            (
                "codex",
                "Stop",
                "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61",
                "Added the retry wrapper to the upload client and the two tests pass.",
            ),
        ),
        (
            "codex-permission.json",
            {},
            ("codex", "PermissionRequest", "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61", "Bash: rm -rf build"),
        ),
        (
            "codex-stop.json",
            CLAUDE_ENV,
            (
                "codex",
                "Stop",
                "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61",
                "Added the retry wrapper to the upload client and the two tests pass.",
            ),
        ),
        ("claude-stop.json", {}, None),
        (
            "claude-user-prompt.json",
            CLAUDE_ENV,
            ("claude-code", "UserPromptSubmit", "bc68d697-4e8f-4be0-8ea6-e67f955b2586", "Please fix the upload client."),
        ),
        (
            "claude-channel-prompt.json",
            CLAUDE_ENV,
            ("claude-code", "UserPromptSubmit", "bc68d697-4e8f-4be0-8ea6-e67f955b2586", ""),
        ),
        (
            "claude-session-end.json",
            CLAUDE_ENV,
            ("claude-code", "SessionEnd", "bc68d697-4e8f-4be0-8ea6-e67f955b2586", "Session ended"),
        ),
        (
            "claude-session-start.json",
            CLAUDE_ENV,
            ("claude-code", "SessionStart", "bc68d697-4e8f-4be0-8ea6-e67f955b2586", ""),
        ),
        ("claude-session-start.json", {**CLAUDE_ENV, "CLAUDE_CODE_ENTRYPOINT": "sdk-cli"}, None),
        (
            "codex-session-start.json",
            {},
            ("codex", "SessionStart", "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61", ""),
        ),
    ],
    ids=[
        "claude-stop",
        "claude-stop-background",
        "claude-stop-sdk-skipped",
        "claude-stop-interactive",
        "claude-permission-sdk-sent",
        "claude-permission",
        "claude-notification-synthetic",
        "codex-stop",
        "codex-permission",
        "codex-under-claude-shell",
        "no-agent-env",
        "claude-user-prompt",
        "claude-channel-prompt-no-entry",
        "claude-session-end",
        "claude-start-synthetic",
        "claude-start-sdk-skipped",
        "codex-start-synthetic",
    ],
)
def test_parse_event(fixture, env, expected):
    event = parse_event(load(fixture), env)
    got = None if event is None else (event.agent, event.phase, event.session_id, event.text)
    assert got == expected


def test_session_end_clear_parses_to_nothing():
    data = load("claude-session-end.json")
    data["reason"] = "clear"
    assert parse_event(data, CLAUDE_ENV) is None


@pytest.mark.parametrize(
    "fixture, rollout, sent",
    [
        ("codex-stop.json", "codex-rollout-cli.jsonl", True),
        ("codex-stop.json", "codex-rollout-vscode.jsonl", True),
        ("codex-stop.json", "codex-rollout-exec.jsonl", False),
        ("codex-stop.json", "codex-rollout-subagent.jsonl", False),
        ("codex-stop.json", "codex-rollout-missing.jsonl", False),
        ("codex-stop.json", None, False),
        ("codex-permission.json", "codex-rollout-exec.jsonl", True),
    ],
    ids=["cli", "vscode", "exec", "subagent", "unreadable", "null-path", "permission-under-exec"],
)
def test_codex_sends_only_interactive_sessions(fixture, rollout, sent):
    event = parse_event(load(fixture, rollout), {})
    assert (event is not None) == sent
    if sent:
        assert event.session_id == CODEX_SESSION
