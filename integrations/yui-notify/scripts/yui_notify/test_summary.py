from yui_notify.summary import summarize


def no_claude(_):
    return None


def has_claude(_):
    return "/usr/bin/claude"


def test_no_claude_cuts_message():
    assert summarize("x" * 2000, "m", which=no_claude) == "x" * 1500


def test_runner_output_is_the_sentence():
    assert (
        summarize("long report", "m", run=lambda cmd, text: " Fixed it.\n", which=has_claude) == "Fixed it."
    )


def test_runner_output_is_cut():
    assert summarize("long report", "m", run=lambda cmd, text: "y" * 3000, which=has_claude) == "y" * 1500


def test_runner_failure_gives_cut_message():
    assert summarize("long report", "m", run=lambda cmd, text: None, which=has_claude) == "long report"
