import json

import pytest
from conftest import load_module

# connected_players is not ordered by index; the host is the admin with the lowest one
STUB = """
storage = { events = require("scripts.ring").new() }
remote = { interfaces = {} }
game = {
  tick = 7,
  connected_players = {
    { index = 2, name = "second", admin = true },
    { index = 1, name = "host", admin = true },
    { index = 3, name = "guest", admin = false },
  },
}
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
        (2, []),  # an admin who is not the host
        (3, []),  # not an admin
        (None, []),  # the server console
    ],
)
def test_chat_records_the_host_lines_only(lua, events, player_index, expected):
    events.on_console_chat(lua.table(player_index=player_index, message="hello"))
    assert json.loads(lua.globals().JSON.encode(lua.globals().storage.events["items"])) == expected
