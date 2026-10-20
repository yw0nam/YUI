import json

import pytest
from conftest import load_module

HOST = "{ index = 1, name = 'host', admin = true }"

STUB = """
storage = {}
require("scripts.storage").ensure()
BODIES = {}
game = { tick = 100, connected_players = {}, get_entity_by_unit_number = function(n) return BODIES[n] end }
remote = { interfaces = {} }
settings = { global = {
  ["coop-agent-body-enabled"] = { value = true },
  ["coop-agent-body-name"] = { value = "Buddy" },
} }
defines = { direction = { north = 0 } }
LABEL = nil
rendering = { draw_text = function(spec)
  LABEL = { valid = true, text = spec.text }
  return LABEL
end }
"""

LIVE_BODY = """
BODIES[7] = {
  valid = true,
  surface = "nauvis",
  color = { r = 1, g = 1, b = 1, a = 0.5 },
  walking_state = { walking = true, direction = 2 },
  mining_state = { mining = true, position = { x = 3, y = 4 } },
  crafting_queue_size = 0,
}
storage.body.unit_number = 7
"""


@pytest.fixture
def body(lua):
    module = load_module(lua, "scripts.body")
    lua.execute(STUB)
    return module


def event_kinds(lua):
    return [e["kind"] for e in json.loads(lua.globals().JSON.encode(lua.globals().storage.events["items"]))]


@pytest.mark.parametrize(
    ("alive", "stopped", "host", "expected"),
    [
        (True, False, True, True),
        (False, False, True, False),
        (True, True, True, False),
        (True, False, False, False),
    ],
)
def test_can_act_needs_a_live_body_no_stop_latch_and_a_host(lua, body, alive, stopped, host, expected):
    if alive:
        lua.execute(LIVE_BODY)
    lua.globals().storage.body.stopped = stopped
    if host:
        lua.execute(f"game.connected_players = {{ {HOST} }}")
    assert body.can_act() is expected


def test_stop_latches_until_the_latch_is_cleared(lua, body):
    lua.execute(LIVE_BODY)
    lua.execute(f"game.connected_players = {{ {HOST} }}")

    body.stop()
    entity = lua.globals().BODIES[7]
    assert body.can_act() is False
    assert lua.globals().storage.body.stopped is True
    assert event_kinds(lua) == ["stopped"]
    assert entity.walking_state.walking is False
    assert entity.mining_state.mining is False
    assert lua.globals().LABEL.text == "Buddy · Stopped"

    body.clear_latch()
    assert body.can_act() is True
    assert lua.globals().LABEL.text == "Buddy · Standing by"


@pytest.mark.parametrize(
    ("died_tick", "tick", "enabled", "due"),
    [
        (100, 1899, True, False),
        (100, 1900, True, True),
        (100, 1900, False, False),
        (None, 5000, True, False),
    ],
)
def test_respawn_is_due_1800_ticks_after_death_while_the_body_is_enabled(
    lua, body, died_tick, tick, enabled, due
):
    lua.globals().storage.body.died_tick = died_tick
    lua.globals().settings["global"]["coop-agent-body-enabled"].value = enabled
    assert body.respawn_due(tick) is due


@pytest.mark.parametrize(
    ("view", "text"),
    [
        ({"status": "Standing by"}, "Buddy · Standing by"),
        ({"status": "Mining iron-ore 3/50"}, "Buddy · Mining iron-ore 3/50"),
        ({"status": "Standing by", "stopped": True}, "Buddy · Stopped"),
        ({"status": "Standing by", "stopped": True, "waiting_for": "host"}, "Buddy · Waiting for host"),
        ({"status": "Standing by", "stopped": True, "waiting_for": "host", "ack": True}, "Buddy · …"),
    ],
)
def test_status_line_shows_the_name_and_the_strongest_state(lua, view, text):
    status_line = load_module(lua, "scripts.body.status_line")
    assert status_line.text("Buddy", lua.table_from(view)) == text


@pytest.mark.parametrize(
    ("name", "color"),
    [
        ("orange", {"r": 0.869, "g": 0.5, "b": 0.130, "a": 0.5}),
        ("red", {"r": 0.815, "g": 0.024, "b": 0.0, "a": 0.5}),
        ("yellow", {"r": 0.835, "g": 0.666, "b": 0.077, "a": 0.5}),
        ("green", {"r": 0.093, "g": 0.768, "b": 0.172, "a": 0.5}),
        ("cyan", {"r": 0.275, "g": 0.755, "b": 0.712, "a": 0.5}),
        ("blue", {"r": 0.155, "g": 0.540, "b": 0.898, "a": 0.5}),
        ("purple", {"r": 0.485, "g": 0.111, "b": 0.659, "a": 0.5}),
        ("white", {"r": 0.8, "g": 0.8, "b": 0.8, "a": 0.5}),
    ],
)
def test_each_body_color_setting_names_the_game_player_color(lua, name, color):
    colors = load_module(lua, "scripts.body.color")
    assert dict(colors.of(name)) == color
