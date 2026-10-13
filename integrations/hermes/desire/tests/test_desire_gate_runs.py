from collections import OrderedDict

import pytest

import desire_gate_runs

WAKE = "desire gate: unread events (2)"


@pytest.fixture(autouse=True)
def no_remembered_turns(monkeypatch):
    monkeypatch.setattr(desire_gate_runs, "_remembered", OrderedDict())


@pytest.mark.parametrize(
    ("text", "started"),
    [
        (WAKE, True),
        (f"{WAKE}\n\nRead what happened.", True),
        (f"## Script Output\n\n```\n{WAKE}\n```", True),
        (f"the gate printed {WAKE} earlier", False),
        (f"> {WAKE}", False),
        ("desire gate: unread\nevents (2)", False),
        (f"{WAKE}\r\nRead what happened.", False),
        ("desire gate: unread events (٢)", False),
        ("desire gate: held notes (1)", False),
    ],
)
def test_only_a_wake_line_standing_on_its_own_line_starts_a_gate_run(text, started):
    assert desire_gate_runs.gate_started(text, None) is started


def test_a_later_request_of_a_remembered_turn_is_gate_started():
    assert desire_gate_runs.gate_started(WAKE, "turn-1")

    assert desire_gate_runs.gate_started("Please continue.", "turn-1")
    assert not desire_gate_runs.gate_started("Please continue.", "turn-2")
    assert not desire_gate_runs.gate_started("Please continue.", None)


def test_the_33rd_remembered_turn_evicts_the_first():
    for index in range(desire_gate_runs.GATE_TURNS_KEPT + 1):
        desire_gate_runs.gate_started(WAKE, f"turn-{index}")

    assert not desire_gate_runs.gate_started("Please continue.", "turn-0")
    assert desire_gate_runs.gate_started("Please continue.", "turn-1")
