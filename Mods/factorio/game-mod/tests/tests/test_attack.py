import json

import pytest
from conftest import load_module

STUB = """
FORCES = {
  player  = { name = "player",  get_friend = function(self, other) return other.name == "allied" end },
  enemy   = { name = "enemy",   get_friend = function(self, other) return false end },
  neutral = { name = "neutral", get_friend = function(self, other) return false end },
  allied  = { name = "allied",  get_friend = function(self, other) return true end },
}
DEPS = {
  storage = { attacks = {} },
  tick = 0,
  player_force = FORCES.player,
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


def damage(lua, attack, entity_force="player", killer="enemy", cause=None, x=10, y=70):
    attack.on_damaged(
        lua.globals().DEPS,
        lua.table(
            surface="nauvis",
            position=lua.table(x=x, y=y),
            entity_force=lua.globals().FORCES[entity_force],
            killer_force=killer and lua.globals().FORCES[killer] or None,
            cause_force=cause and lua.globals().FORCES[cause] or None,
        ),
    )


def died(lua, attack, name, entity_force="player", killer="enemy", cause=None, x=10, y=70):
    attack.on_died(
        lua.globals().DEPS,
        lua.table(
            surface="nauvis",
            position=lua.table(x=x, y=y),
            name=name,
            entity_force=lua.globals().FORCES[entity_force],
            killer_force=killer and lua.globals().FORCES[killer] or None,
            cause_force=cause and lua.globals().FORCES[cause] or None,
        ),
    )


def sweep(lua, attack, tick):
    set_tick(lua, tick)
    attack.sweep(lua.globals().DEPS, tick)


@pytest.mark.parametrize(
    ("entity", "killer", "cause", "expected"),
    [
        ("player", "enemy", None, True),  # the attacking force alone is enough
        ("player", None, "enemy", True),  # cause.force is the fallback
        ("player", "enemy", "allied", True),  # event.force wins over the cause
        ("enemy", "player", None, False),  # our own hits are not defender hits
        ("player", "player", None, False),  # friendly fire
        ("player", "allied", None, False),  # allies are friends
        ("player", "neutral", None, False),  # the neutral force never attacks
        ("player", None, None, False),  # no attacker named, no hit
    ],
)
def test_defender_hit_filters_who_counts_as_attacked(lua, attack, entity, killer, cause, expected):
    player = lua.globals().FORCES.player
    forces = lua.globals().FORCES
    hit = attack.defender_hit(
        player, forces[entity], killer and forces[killer] or None, cause and forces[cause] or None
    )
    assert hit is expected


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
    died(lua, attack, "gun-turret")
    died(lua, attack, "small-biter")
    died(lua, attack, "small-biter")

    sweep(lua, attack, 1199)  # 600 quiet ticks after the last damage at t=0
    events = pushed(lua)
    assert [e["kind"] for e in events] == ["attack_started", "attack_ended"]
    ended = events[1]["data"]
    assert ended["cell"] == {"surface": "nauvis", "x": 0, "y": 64}
    assert ended["duration_s"] == pytest.approx(1199 / 60)
    assert ended["losses"] == [{"name": "gun-turret", "count": 1}, {"name": "small-biter", "count": 2}]
    assert len(list(lua.globals().DEPS.storage.attacks.values())) == 0


def test_an_enemy_death_in_the_cell_is_not_a_loss(lua, attack):
    damage(lua, attack)
    died(lua, attack, "small-biter", entity_force="enemy", killer="player")

    sweep(lua, attack, 600)
    ended = [e for e in pushed(lua) if e["kind"] == "attack_ended"]
    assert ended == [
        {
            "kind": "attack_ended",
            "data": {
                "cell": {"surface": "nauvis", "x": 0, "y": 64},
                "duration_s": pytest.approx(10),
                "losses": [],
            },
        }
    ]


def test_a_defender_death_without_an_attacker_is_not_a_loss(lua, attack):
    damage(lua, attack)
    died(lua, attack, "gun-turret", killer=None, cause=None)

    sweep(lua, attack, 600)
    ended = [e for e in pushed(lua) if e["kind"] == "attack_ended"]
    assert ended[0]["data"]["losses"] == []


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
