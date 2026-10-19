import json

import pytest
from conftest import load_module

STUB = """
storage = { events = require("scripts.ring").new() }
PLAYERS = { { name = "host", admin = true }, { name = "guest", admin = false } }
game = { tick = 7, get_player = function(index) return PLAYERS[index] end }
"""


@pytest.fixture
def events(lua):
    module = load_module(lua, "scripts.events")
    lua.execute(STUB)
    return module


@pytest.mark.parametrize(
    ("player_index", "expected"),
    [
        (1, [{"seq": 1, "tick": 7, "kind": "chat", "data": {"player": "host", "text": "hello"}}]),
        (2, []),  # not an admin
        (None, []),  # the server console
    ],
)
def test_chat_records_admin_lines_only(lua, events, player_index, expected):
    events.on_console_chat(lua.table(player_index=player_index, message="hello"))
    assert json.loads(lua.globals().JSON.encode(lua.globals().storage.events["items"])) == expected
