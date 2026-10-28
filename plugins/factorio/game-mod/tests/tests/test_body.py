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
  -- a cancelled craft returns its reserved ingredients to the inventory
  entity.cancel_crafting = function(spec)
    CANCELLED[#CANCELLED + 1] = spec
    entity.crafting_queue_size = 0
    entity.inventories[2] = { name = "iron-plate", count = 6 }
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
HOST = { index = 1, name = "host", position = { x = 0, y = 0 }, surface = SURFACE }
EVENTS = {}
DEPS = {
  storage = storage,
  tick = 100,
  enabled = true,
  body_name = "Buddy",
  prototype = "character",
  color = "orange",
  host = function() return HOST end,
  push = function(kind, _data) EVENTS[#EVENTS + 1] = kind end,
  draw_text = function(spec)
    LABEL = { valid = true, text = spec.text }
    return LABEL
  end,
  entity_prototypes = { character = { type = "character" }, ["odd-character"] = { type = "character" } },
  force = "player",
  starter_items = function() return nil end,
}
"""


@pytest.fixture
def body(lua):
    module = load_module(lua, "scripts.body")
    lua.execute(STUB)
    return module


def deps(lua):
    return lua.globals().DEPS


def spawned(lua, body):
    """A body made by a sweep with the host connected."""
    body.sweep(deps(lua))
    return lua.globals().storage.body.entity


def no_host(lua):
    lua.execute("DEPS.host = function() return nil end")


def event_kinds(lua):
    return list(lua.globals().EVENTS.values())


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
        no_host(lua)
    assert body.can_act(deps(lua)) is expected


def test_stop_halts_the_body_and_latches_once_until_cleared(lua, body):
    entity = spawned(lua, body)

    body.stop(deps(lua))
    body.stop(deps(lua))
    assert body.can_act(deps(lua)) is False
    assert event_kinds(lua) == ["stopped"]
    assert entity.walking_state.walking is False
    assert entity.mining_state.mining is False
    assert [dict(spec) for spec in lua.globals().CANCELLED.values()] == [{"index": 1, "count": 3}]
    assert label(lua) == "Buddy · Stopped"

    body.clear_latch(deps(lua))
    assert body.can_act(deps(lua)) is True
    assert label(lua) == "Buddy · Standing by"


@pytest.mark.parametrize(
    ("prototype", "made"),
    [
        ("odd-character", "odd-character"),
        ("no-such-thing", "character"),
    ],
)
def test_sweeps_keep_one_body_of_the_prototype_setting(lua, body, prototype, made):
    deps(lua).prototype = prototype
    body.sweep(deps(lua))
    body.sweep(deps(lua))
    assert created(lua) == [made]
    assert lua.globals().storage.body.unit_number is not None
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
    body.on_entity_died(deps(lua), lua.table(entity=entity, tick=100))
    entity.valid = False

    deps(lua).tick = tick
    deps(lua).enabled = enabled
    body.sweep(deps(lua))
    assert created(lua) == made
    assert event_kinds(lua) == kinds


def test_disabling_cancels_crafts_spills_the_body_inventory_and_removes_it(lua, body):
    entity = spawned(lua, body)
    deps(lua).enabled = False
    body.sweep(deps(lua))
    assert [dict(spec) for spec in lua.globals().CANCELLED.values()] == [{"index": 1, "count": 3}]
    assert [dict(items) for items in lua.globals().SPILLED.values()] == [
        {"name": "coal", "count": 5},
        {"name": "iron-plate", "count": 6},
    ]
    assert entity.valid is False
    assert body.can_act(deps(lua)) is False


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
    body.set_status(deps(lua), status)
    if not host:
        no_host(lua)
    body.sweep(deps(lua))
    assert label(lua) == text


def test_a_host_chat_line_shows_an_ellipsis_for_180_ticks(lua, body):
    spawned(lua, body)
    deps(lua).tick = 1000
    body.acknowledge_chat(deps(lua))
    assert label(lua) == "Buddy · …"

    deps(lua).tick = 1179
    body.sweep(deps(lua))
    assert label(lua) == "Buddy · …"
    deps(lua).tick = 1180
    body.sweep(deps(lua))
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
