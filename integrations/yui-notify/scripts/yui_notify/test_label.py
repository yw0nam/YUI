import pytest

from yui_notify.label import context, make_label


def runner(branch, tmux):
    def run(cmd, timeout):
        return {"git": branch, "tmux": tmux}[cmd[0]]

    return run


@pytest.mark.parametrize(
    "env, branch, tmux, host, expected",
    [
        (
            {"SSH_CONNECTION": "1 2 3 4", "TMUX": "/tmp/tmux-1/default,1,0", "TMUX_PANE": "%3"},
            "main",
            "yui:2",
            "dev43",
            "dev43 · tmux yui:2 · YUI (main)",
        ),
        ({}, None, None, None, "YUI"),
        ({}, "main", None, None, "YUI (main)"),
    ],
    ids=["ssh-tmux-branch", "none", "branch-only"],
)
def test_label(env, branch, tmux, host, expected):
    ctx = context("/work/YUI", env, runner(branch, tmux), hostname=lambda: "dev43.example.com")
    assert ctx["host"] == host
    assert make_label(ctx) == expected
    assert ctx["project"] == "YUI"
