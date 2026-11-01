import pytest

from yui_notify.host.label import context, make_label


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
            "devbox",
            "devbox, tmux yui:2",
        ),
        ({}, None, None, None, None),
        ({}, "main", None, None, None),
    ],
    ids=["ssh-tmux-branch", "none", "branch-only"],
)
def test_label(env, branch, tmux, host, expected):
    ctx = context("/work/YUI", env, runner(branch, tmux), hostname=lambda: "devbox.example.com")
    assert ctx["host"] == host
    assert make_label(ctx) == expected
    assert ctx["project"] == "YUI"
