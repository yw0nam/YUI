import json

import pytest
from conftest import GAME_MOD, load_module

STUB = """
storage = {}
require("scripts.storage").ensure()
CREATED, SPILLED, CANCELLED = {}, {}, {}
LABEL = nil
NEXT_UNIT = 40

function new_entity(name)
  NEXT_UNIT = NEXT_UNIT + 1
  local entity = {
    valid = true,
    name = name,
    unit_number = NEXT_UNIT,
    position = { x = 1, y = 0 },
    color = nil,
    walking_state = { walking = true, direction = 2 },
    mining_state = { mining = true, position = { x = 3, y = 4 } },
    crafting_queue = { { index = 1, recipe = "iron-gear-wheel", count = 3 } },
    crafting_queue_size = 1,
    inventories = { { name = "coal", count = 5 } },
  }
  entity.surface = SURFACE
  entity.destroy = function() entity.valid = false end
  entity.cancel_crafting = function(spec)
    CANCELLED[#CANCELLED + 1] = spec
    entity.crafting_queue_size = 0
  end
  entity.get_max_inventory_index = function() return #entity.inventories end
  entity.get_inventory = function(index)
    local items = entity.inventories[index]
    return { is_empty = function() return items == nil end, items = items }
  end
  return entity
end

SURFACE = {
  find_non_colliding_position = function(_name, center) return { x = center.x + 1, y = center.y } end,
  create_entity = function(spec)
    CREATED[#CREATED + 1] = spec.name
    return new_entity(spec.name)
  end,
  spill_inventory = function(spec) SPILLED[#SPILLED + 1] = spec.inventory.items end,
}
HOST = { index = 1, name = "host", admin = true, position = { x = 0, y = 0 }, surface = SURFACE }
game = {
  tick = 100,
  connected_players = { HOST },
  forces = { player = "player" },
  -- a prototype without the get-by-unit-number flag: the lookup never finds the body
  get_entity_by_unit_number = function(_n) return nil end,
}
prototypes = { entity = { character = { type = "character" }, ["odd-character"] = { type = "character" } } }
remote = { interfaces = {} }
settings = { global = {
  ["coop-agent-body-enabled"] = { value = true },
  ["coop-agent-body-name"] = { value = "Buddy" },
  ["coop-agent-body-prototype"] = { value = "character" },
  ["coop-agent-body-color"] = { value = "orange" },
} }
rendering = { draw_text = function(spec)
  LABEL = { valid = true, text = spec.text }
  return LABEL
end }
"""


@pytest.fixture
def body(lua):
    module = load_module(lua, "scripts.body")
    lua.execute(STUB)
    return module


def spawned(lua, body):
    """A body made by a sweep with the host connected."""
    body.sweep()
    return lua.globals().storage.body.entity


def event_kinds(lua):
    return [e["kind"] for e in json.loads(lua.globals().JSON.encode(lua.globals().storage.events["items"]))]


def created(lua):
    return list(lua.globals().CREATED.values())


def label(lua):
    return lua.globals().LABEL.text


@pytest.mark.parametrize(
    ("alive", "host", "expected"),
    [
        (True, True, True),
        (False, True, False),
        (True, False, False),
    ],
)
def test_can_act_needs_a_live_body_and_a_host(lua, body, alive, host, expected):
    if alive:
        spawned(lua, body)
    if not host:
        lua.execute("game.connected_players = {}")
    assert body.can_act() is expected


def test_stop_halts_the_body_and_latches_once_until_cleared(lua, body):
    entity = spawned(lua, body)

    body.stop()
    body.stop()
    assert body.can_act() is False
    assert event_kinds(lua) == ["stopped"]
    assert entity.walking_state.walking is False
    assert entity.mining_state.mining is False
    assert [dict(spec) for spec in lua.globals().CANCELLED.values()] == [{"index": 1, "count": 3}]
    assert label(lua) == "Buddy · Stopped"

    body.clear_latch()
    assert body.can_act() is True
    assert label(lua) == "Buddy · Standing by"


@pytest.mark.parametrize(
    ("prototype", "made"),
    [
        ("odd-character", "odd-character"),
        ("no-such-thing", "character"),
    ],
)
def test_sweeps_keep_one_body_of_the_prototype_setting(lua, body, prototype, made):
    lua.globals().settings["global"]["coop-agent-body-prototype"].value = prototype
    body.sweep()
    body.sweep()
    assert created(lua) == [made]
    assert lua.globals().storage.body.unit_number == 41
    assert label(lua) == "Buddy · Standing by"


@pytest.mark.parametrize(
    ("tick", "enabled", "made", "kinds"),
    [
        (1899, True, [], ["body_died"]),
        (1900, True, ["character"], ["body_died", "body_respawned"]),
        (1900, False, [], ["body_died"]),
    ],
)
def test_a_dead_body_respawns_1800_ticks_later_while_enabled(lua, body, tick, enabled, made, kinds):
    entity = spawned(lua, body)
    lua.execute("CREATED = {}")
    body.on_entity_died(lua.table(entity=entity, tick=100))
    entity.valid = False

    lua.globals().game.tick = tick
    lua.globals().settings["global"]["coop-agent-body-enabled"].value = enabled
    body.sweep()
    assert created(lua) == made
    assert event_kinds(lua) == kinds


def test_disabling_spills_the_body_inventory_and_removes_it(lua, body):
    entity = spawned(lua, body)
    lua.globals().settings["global"]["coop-agent-body-enabled"].value = False
    body.sweep()
    assert [dict(items) for items in lua.globals().SPILLED.values()] == [{"name": "coal", "count": 5}]
    assert entity.valid is False
    assert body.can_act() is False


@pytest.mark.parametrize(
    ("stopped", "host", "status", "text"),
    [
        (False, True, "Mining iron-ore 3/50", "Buddy · Mining iron-ore 3/50"),
        (True, True, "Standing by", "Buddy · Stopped"),
        (False, False, "Standing by", "Buddy · Waiting for host"),
        (True, False, "Standing by", "Buddy · Stopped"),
    ],
)
def test_the_label_shows_the_strongest_state(lua, body, stopped, host, status, text):
    spawned(lua, body)
    lua.globals().storage.body.stopped = stopped
    body.set_status(status)
    if not host:
        lua.execute("game.connected_players = {}")
    body.sweep()
    assert label(lua) == text


def test_a_host_chat_line_shows_an_ellipsis_for_180_ticks(lua, body):
    spawned(lua, body)
    lua.globals().game.tick = 1000
    body.on_console_chat(lua.table(player_index=1))
    assert label(lua) == "Buddy · …"

    lua.globals().game.tick = 1179
    body.sweep()
    assert label(lua) == "Buddy · …"
    lua.globals().game.tick = 1180
    body.sweep()
    assert label(lua) == "Buddy · Standing by"


def test_every_body_color_setting_value_maps_to_a_color(lua):
    lua.execute("SETTINGS = {} data = { extend = function(_, list) SETTINGS = list end }")
    lua.execute(f'dofile("{GAME_MOD / "coop-agent" / "settings.lua"}")')
    colors = load_module(lua, "scripts.body.color")
    allowed = next(
        s for s in lua.globals().SETTINGS.values() if s.name == "coop-agent-body-color"
    ).allowed_values
    missing = [name for name in allowed.values() if lua.eval("type")(colors.of(name)) != "table"]
    assert missing == []
