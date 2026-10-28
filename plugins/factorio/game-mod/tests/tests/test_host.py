import pytest
from conftest import load_module

# a player's position is the remote view; physical_position is where the character stands
STUB = """
remote = { interfaces = {} }
game = {
  connected_players = {
    { index = 1, name = "host", admin = true, connected = true,
      position = { x = 5, y = 5 }, physical_position = { x = 9, y = 3 },
      surface = "map-view", physical_surface = "playground" },
  },
}
"""


@pytest.fixture
def host(lua):
    module = load_module(lua, "scripts.host")
    lua.execute(STUB)
    return module


def test_get_maps_the_host_to_a_plain_table_of_its_physical_self(lua, host):
    got = host.get()
    assert dict(got.position) == {"x": 9, "y": 3}
    assert got.surface == "playground"
    assert (got.name, got.index, got.connected) == ("host", 1, True)
    assert got.admin is None  # a plain table, never the player object
