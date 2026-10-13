"""Which requests belong to a run the gate started for unread events."""

from __future__ import annotations

import re
from collections import OrderedDict

if __package__:
    from . import desire_config
else:
    import desire_config

GATE_TURNS_KEPT = 32
_WAKE = re.compile(rf"^{re.escape(desire_config.WAKE_UNREAD_EVENTS)} \([0-9]+\)$", re.MULTILINE)
_remembered: OrderedDict[str, None] = OrderedDict()


def gate_started(text: str, turn_id: str | None) -> bool:
    """Report whether the gate started this turn for unread events, and remember the turn when the text says so.

    A request whose text carries the wake line records its turn id; a later request with a remembered
    turn id counts as gate-started whatever its text.
    """

    if _WAKE.search(text) is None:
        return turn_id is not None and turn_id in _remembered
    if turn_id is not None:
        _remembered[turn_id] = None
        _remembered.move_to_end(turn_id)
        while len(_remembered) > GATE_TURNS_KEPT:
            _remembered.popitem(last=False)
    return True
