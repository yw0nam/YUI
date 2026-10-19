import json

import pytest
from conftest import load_module

# LuaForce methods take dot calls, so get_friend receives only the other force
STUB = """
FORCES = {
  player  = { name = "player",  get_friend = function(other) return other.name == "allied" end },
  enemy   = { name = "enemy" },
  neutral = { name = "neutral" },
  allied  = { name = "allied" },
}
PUSHED = {}
COUNTED = {}
DEPS = {
  storage = { attacks = {} },
  tick = 0,
  player_force = FORCES.player,
  count_cell = function(cell)
    COUNTED[#COUNTED + 1] = cell
    return { enemies = 3, defenders = 2 }
  end,
  push = function(kind, data) PUSHED[#PUSHED + 1] = { kind = kind, data = data } end,
}
"""

CELL = {"surface": "nauvis", "x": 0, "y": 64}


@pytest.fixture
def attack(lua):
    module = load_module(lua, "scripts.attack")
    lua.execute(STUB)
    return module


def pushed(lua):
    return json.loads(lua.globals().JSON.encode(lua.globals().PUSHED))


def hit(lua, entity_force="player", attacker="enemy", cause=None, x=10, y=70, name=None):
    forces = lua.globals().FORCES
    return lua.table(
        surface="nauvis",
        position=lua.table(x=x, y=y),
        name=name,
        entity_force=forces[entity_force],
        attacker_force=forces[attacker] if attacker else None,
        cause_force=forces[cause] if cause else None,
    )


def damage(lua, attack, tick=0, **kwargs):
    lua.globals().DEPS.tick = tick
    attack.on_damaged(lua.globals().DEPS, hit(lua, **kwargs))


def died(lua, attack, name, **kwargs):
    attack.on_died(lua.globals().DEPS, hit(lua, name=name, **kwargs))


def sweep(lua, attack, tick):
    lua.globals().DEPS.tick = tick
    attack.sweep(lua.globals().DEPS, tick)


@pytest.mark.parametrize(
    ("entity", "attacker", "cause", "opens"),
    [
        ("player", "enemy", None, True),  # the attacking force alone is enough
        ("player", None, "enemy", True),  # cause.force is the fallback
        ("player", "allied", "enemy", False),  # event.force wins over the cause
        ("enemy", "player", None, False),  # our own hits on the enemy
        ("player", "player", None, False),  # friendly fire
        ("player", "allied", None, False),  # allies are friends
        ("player", "neutral", None, False),  # the neutral force never attacks
        ("player", None, None, False),  # no attacker named
    ],
)
def test_only_hostile_damage_to_the_player_force_opens_a_cell(lua, attack, entity, attacker, cause, opens):
    damage(lua, attack, entity_force=entity, attacker=attacker, cause=cause)
    expected = [{"kind": "attack_started", "data": {"cell": CELL, "enemies": 3, "defenders": 2}}]
    assert pushed(lua) == (expected if opens else [])


def test_more_damage_in_an_open_cell_emits_nothing_and_counts_the_cell_once(lua, attack):
    damage(lua, attack)
    damage(lua, attack)

    assert pushed(lua) == [{"kind": "attack_started", "data": {"cell": CELL, "enemies": 3, "defenders": 2}}]
    assert json.loads(lua.globals().JSON.encode(lua.globals().COUNTED)) == [CELL]


def test_damage_599_ticks_later_keeps_the_cell_open(lua, attack):
    damage(lua, attack)
    damage(lua, attack, tick=599)

    sweep(lua, attack, 1198)  # 599 quiet ticks after the last damage
    assert [e["kind"] for e in pushed(lua)] == ["attack_started"]


@pytest.mark.parametrize(
    ("victim", "attacker", "losses"),
    [
        ("player", "enemy", [{"name": "gun-turret", "count": 1}, {"name": "stone-wall", "count": 2}]),
        ("enemy", "player", []),  # an enemy dying in the cell is not a loss
        ("player", None, []),  # a death no hostile force caused is not a loss
    ],
)
def test_600_quiet_ticks_emit_attack_ended_with_the_player_losses(lua, attack, victim, attacker, losses):
    damage(lua, attack)
    for name in ("stone-wall", "gun-turret", "stone-wall"):
        died(lua, attack, name, entity_force=victim, attacker=attacker)

    sweep(lua, attack, 600)
    assert pushed(lua)[1:] == [
        {"kind": "attack_ended", "data": {"cell": CELL, "duration_s": 10, "losses": losses}}
    ]
    assert list(lua.globals().DEPS.storage.attacks.keys()) == []


def test_deaths_in_a_cell_with_no_open_attack_are_ignored(lua, attack):
    died(lua, attack, "gun-turret")
    sweep(lua, attack, 600)
    assert pushed(lua) == []


def test_a_second_cell_opens_its_own_attack(lua, attack):
    damage(lua, attack)
    damage(lua, attack, x=200, y=200)

    assert [e["data"]["cell"] for e in pushed(lua)] == [CELL, {"surface": "nauvis", "x": 192, "y": 192}]
