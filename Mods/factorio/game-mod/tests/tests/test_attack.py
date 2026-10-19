import json

import pytest
from conftest import load_module

STUB = """
DEPS = {
  storage = { attacks = {} },
  tick = 0,
  count_cell = function(surface, cell)
    COUNTED[#COUNTED + 1] = { surface = surface, x = cell.x, y = cell.y }
    return { enemies = 3, defenders = 2 }
  end,
  push = function(kind, data) PUSHED[#PUSHED + 1] = { kind = kind, data = data } end,
}
"""


@pytest.fixture
def attack(lua):
    module = load_module(lua, "scripts.attack")
    lua.execute("PUSHED = {}")
    lua.execute("COUNTED = {}")
    lua.execute(STUB)
    return module


def pushed(lua):
    return json.loads(lua.globals().JSON.encode(lua.globals().PUSHED))


def set_tick(lua, tick):
    lua.globals().DEPS.tick = tick


def damage(lua, attack, x=10, y=70):
    attack.on_damaged(lua.globals().DEPS, lua.table(surface="nauvis", position=lua.table(x=x, y=y)))


def died(lua, attack, name, x=10, y=70):
    attack.on_died(lua.globals().DEPS, lua.table(surface="nauvis", position=lua.table(x=x, y=y), name=name))


def sweep(lua, attack, tick):
    set_tick(lua, tick)
    attack.sweep(lua.globals().DEPS, tick)


def test_first_damage_opens_a_cell_and_emits_attack_started_once(lua, attack):
    damage(lua, attack)
    damage(lua, attack)  # same cell, same tick

    events = pushed(lua)
    assert events == [
        {
            "kind": "attack_started",
            "data": {"cell": {"surface": "nauvis", "x": 0, "y": 64}, "enemies": 3, "defenders": 2},
        }
    ]
    assert len(list(lua.globals().DEPS.storage.attacks.values())) == 1
    assert len(list(lua.globals().COUNTED.values())) == 1  # the cell was counted only at open time


def test_damage_599_ticks_later_keeps_the_cell_open(lua, attack):
    damage(lua, attack)
    set_tick(lua, 599)
    damage(lua, attack)

    sweep(lua, attack, 600)  # 1 quiet tick after the last damage
    assert [e["kind"] for e in pushed(lua)] == ["attack_started"]


def test_600_quiet_ticks_emit_attack_ended_with_losses_aggregated_by_name(lua, attack):
    damage(lua, attack)
    set_tick(lua, 5)
    died(lua, attack, "small-biter")
    died(lua, attack, "gun-turret")
    died(lua, attack, "small-biter")

    sweep(lua, attack, 599)
    assert [e["kind"] for e in pushed(lua)] == ["attack_started"]

    sweep(lua, attack, 1199)  # 600 quiet ticks after the last damage at t=0
    events = pushed(lua)
    assert [e["kind"] for e in events] == ["attack_started", "attack_ended"]
    ended = events[1]["data"]
    assert ended["cell"] == {"surface": "nauvis", "x": 0, "y": 64}
    assert ended["duration_s"] == pytest.approx(1199 / 60)
    assert ended["losses"] == [{"name": "gun-turret", "count": 1}, {"name": "small-biter", "count": 2}]
    assert len(list(lua.globals().DEPS.storage.attacks.values())) == 0


def test_deaths_in_a_cell_with_no_open_attack_are_ignored(lua, attack):
    died(lua, attack, "small-biter")
    assert pushed(lua) == []


def test_a_second_cell_opens_its_own_attack(lua, attack):
    damage(lua, attack)
    damage(lua, attack, x=200, y=200)

    events = pushed(lua)
    assert [e["data"]["cell"] for e in events] == [
        {"surface": "nauvis", "x": 0, "y": 64},
        {"surface": "nauvis", "x": 192, "y": 192},
    ]
