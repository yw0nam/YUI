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


@pytest.mark.parametrize(
    "fixture, env, expected",
    [
        (
            "claude-stop.json",
            CLAUDE_ENV,
            ("claude-code", "done", "bc68d697-4e8f-4be0-8ea6-e67f955b2586", CLAUDE_STOP_TEXT),
        ),
        ("claude-stop-background.json", CLAUDE_ENV, None),
        (
            "claude-permission.json",
            CLAUDE_ENV,
            (
                "claude-code",
                "needs_input",
                "bc68d697-4e8f-4be0-8ea6-e67f955b2586",
                "Bash: touch /Users/dev/projects/demo/hello.txt",
            ),
        ),
        (
            "claude-notification.json",
            CLAUDE_ENV,
            (
                "claude-code",
                "needs_input",
                "bc68d697-4e8f-4be0-8ea6-e67f955b2586",
                "The github MCP server is asking for your input",
            ),
        ),
        (
            "codex-stop.json",
            {},
            (
                "codex",
                "done",
                "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61",
                "Added the retry wrapper to the upload client and the two tests pass.",
            ),
        ),
        (
            "codex-permission.json",
            {},
            ("codex", "needs_input", "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61", "Bash: rm -rf build"),
        ),
        (
            "codex-stop.json",
            CLAUDE_ENV,
            (
                "codex",
                "done",
                "019a1f2e-7c4b-7d30-9b1e-3f5a8c2d4e61",
                "Added the retry wrapper to the upload client and the two tests pass.",
            ),
        ),
        ("claude-stop.json", {}, None),
    ],
    ids=[
        "claude-stop",
        "claude-stop-background",
        "claude-permission",
        "claude-notification-synthetic",
        "codex-stop",
        "codex-permission",
        "codex-under-claude-shell",
        "no-agent-env",
    ],
)
def test_parse_event(fixture, env, expected):
    event = parse_event(json.loads((FIXTURES / fixture).read_text()), env)
    got = None if event is None else (event.agent, event.phase, event.session_id, event.text)
    assert got == expected
