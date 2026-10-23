import os

import pytest

from yui_notify.summary import summarize

PROMPT = "Summarize in one English sentence what the coding agent reported. Output only the sentence."


def no_claude(_):
    return None


def has_claude(_):
    return "/usr/bin/claude"


def no_run(cmd, text):
    raise AssertionError("runner called")


class Run:
    def __call__(self, cmd, text):
        self.cmd, self.text = cmd, text
        return " Fixed it.\n"


@pytest.mark.parametrize(
    "agent, argv",
    [
        (
            "claude-code",
            [
                "claude",
                "-p",
                "--model",
                "m",
                "--no-session-persistence",
                "--settings",
                '{"disableAllHooks":true}',
                PROMPT,
            ],
        ),
        (
            "codex",
            [
                "codex",
                "exec",
                "-m",
                "m",
                "--ephemeral",
                "--skip-git-repo-check",
                "-s",
                "read-only",
                "--color",
                "never",
                "--disable",
                "hooks",
                PROMPT,
            ],
        ),
    ],
    ids=["claude-code", "codex"],
)
def test_long_message_runs_the_agent_cli(agent, argv):
    run = Run()
    assert summarize("x" * 1501, agent, {agent: "m"}, run=run, which=has_claude) == "Fixed it."
    assert (run.cmd, run.text) == (argv, "x" * 1501)


@pytest.mark.parametrize(
    "models, which_fn",
    [
        (None, has_claude),
        ({"codex": "m"}, has_claude),
        ({"claude-code": "m"}, no_claude),
    ],
    ids=["no-models", "model-missing", "cli-missing"],
)
def test_without_a_runnable_model_cuts_message(models, which_fn):
    assert summarize("x" * 2000, "claude-code", models, run=no_run, which=which_fn) == "x" * 1500


@pytest.mark.parametrize(
    "out",
    ["y" * 3000, None],
    ids=["output-too-long", "runner-failure"],
)
def test_unusable_runner_output_cuts_message(out):
    assert (
        summarize(
            "x" * 2000, "claude-code", {"claude-code": "m"}, run=lambda cmd, text: out, which=has_claude
        )
        == "x" * 1500
    )


def test_short_message_sends_itself():
    assert summarize("x" * 1500, "claude-code", {"claude-code": "m"}, run=no_run) == "x" * 1500


def test_real_runner_marks_the_child(tmp_path, monkeypatch):
    fake = tmp_path / "claude"
    fake.write_text('#!/bin/sh\nprintf %s "$YUI_NOTIFY_CHILD"\n')
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    assert summarize("x" * 2000, "claude-code", {"claude-code": "m"}) == "1"
