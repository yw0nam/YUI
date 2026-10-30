import json
import os
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent.parent
FIXTURES = PLUGIN_ROOT / "tests" / "fixtures"


def test_stop_hook_returns_at_once_and_the_poller_posts_the_answer(tmp_path, server, inbox):
    endpoint, received = server
    received.answer = {"text": "go on"}
    cfg_dir = tmp_path / "cfg" / "yui-notify"
    cfg_dir.mkdir(parents=True)
    (cfg_dir / "config.json").write_text(json.dumps({"endpoint": endpoint}))
    env = dict(
        os.environ,
        CLAUDECODE="1",
        CLAUDE_CODE_MESSAGING_SOCKET=inbox.path,
        XDG_CONFIG_HOME=str(tmp_path / "cfg"),
        XDG_STATE_HOME=str(tmp_path / "state"),
    )
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    env.pop("CLAUDE_CODE_MESSAGING_TOKEN", None)
    try:
        hook = subprocess.run(
            [sys.executable, str(PLUGIN_ROOT / "bin" / "yui-notify"), "hook"],
            input=(FIXTURES / "claude-stop.json").read_bytes(),
            capture_output=True,
            env=env,
            check=False,
            timeout=5,
        )
        # a waiting hook would print the block decision for the answer it fetched
        assert (hook.returncode, hook.stdout) == (0, b"")
        lines = inbox.wait(1)
        assert [json.loads(line) for line in lines] == [
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": "Reply from the user in YUI's Threads window:\ngo on",
                },
            }
        ]
    finally:
        subprocess.run(["pkill", "-f", f"yui-notify inbox {endpoint}"], check=False)
