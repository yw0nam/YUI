import pytest
from conftest import events, rpc, run

THREAT_FAILED = [{"kind": "job_failed", "data": {"id": 1, "kind": "walk_to", "reason": "threat"}}]


@pytest.fixture
def world(lua, world):
    # the walker hooks on DEPS, and one game tick as control.lua wires it: the 60-tick sweep, then the runner,
    # idle and the retreat
    lua.execute(
        "THREAT = require('scripts.threat') THREAT.guard(DEPS) "
        "function GAME_TICK(deps) "
        "if deps.tick % 60 == 0 then THREAT.sweep(deps) end "
        "JOBS.tick(deps) IDLE.tick(deps) THREAT.tick(deps) "
        "end"
    )
    return world


def enqueue(world, *jobs, id_="t"):
    assert rpc(world, "jobs_enqueue", {"jobs": list(jobs)}, id_)["ok"] is True


def states(world):
    return [(job["id"], job["state"], job.get("reason")) for job in rpc(world, "jobs", {}, "read")["r"]]


def walk_to(x, y, radius=1):
    return {"kind": "walk_to", "args": {"pos": {"x": x, "y": y}, "radius": radius}}


def answer(lua, world, *points):
    world.answer(lua.table_from([lua.table_from(p) for p in points]), False)


def game(world, n):
    world.step(n, world.GAME_TICK)


def host_at(lua, x):
    lua.execute(f"HOST.position = {{ x = {x}, y = 0 }}")


def threaten(lua, world, enemy_x):
    """The host 40 tiles west, an enemy on the x axis, and the 60-tick sweep on the next game tick."""
    host_at(lua, -40)
    lua.execute(f"enemy({enemy_x}, 0)")
    world.DEPS.tick = 59
    game(world, 1)


def label(world):
    return world.LABEL.text


def test_a_route_is_sampled_every_8_tiles_with_its_ends(lua, world):
    enqueue(world, walk_to(10, 20))
    run(world, 1)
    answer(lua, world, [0, 0], [10, 0], [10, 20])
    # the target check at the job's start, then the route samples with the safe radius + 4
    assert [tuple(q.values()) for q in world.ENEMY_QUERIES.values()] == [
        (10, 20, 48),
        (0, 0, 52),
        (8, 0, 52),
        (10, 6, 52),
        (10, 14, 52),
        (10, 20, 52),
    ]


@pytest.mark.parametrize(
    ("layout", "ends", "walking"), [("enemy(50, 40)", THREAT_FAILED, False), ("", [], True)]
)
def test_a_route_whose_midpoint_passes_40_tiles_from_a_biter_is_rejected(lua, world, layout, ends, walking):
    lua.execute(layout)
    enqueue(world, walk_to(100, 0))
    run(world, 1)
    answer(lua, world, [50, 0], [100, 0])
    run(world, 2)
    assert events(world) == ends
    assert world.BODY.walking_state.walking is walking


@pytest.mark.parametrize(
    ("layout", "job"),
    [
        ("place('coal', 2, 0) enemy(32, 0)", {"kind": "mine", "args": {"name": "coal", "count": 10}}),
        ("enemy(30, 0)", walk_to(10, 0)),
    ],
)
def test_a_target_within_the_safe_radius_of_an_enemy_fails_threat_at_the_start(lua, world, layout, job):
    lua.execute(layout)
    enqueue(world, job)
    run(world, 3)
    assert events(world) == [
        {"kind": "job_failed", "data": {"id": 1, "kind": job["kind"], "reason": "threat"}}
    ]
    assert len(world.REQUESTS) == 0
    assert dict(world.BODY.position) == {"x": 0, "y": 0}


@pytest.mark.parametrize(
    ("layout", "to", "rejected"),
    [
        ("enemy(0, -10)", (0, 5), None),  # straight away: the start stays the nearest point
        ("enemy(0, -10)", (5, 0), None),  # across: the start stays the nearest point
        ("enemy(0, -10)", (0, -5), "threat"),  # straight toward
        ("enemy(0, -10)", (5, -1), "threat"),  # slightly toward
        ("enemy(0, -60)", (0, -5), None),  # beyond the safe radius + 4 of the start
        ("enemy(0, -10, 'neutral')", (0, -5), None),  # not an enemy force
    ],
)
def test_a_segment_is_rejected_only_when_it_comes_closer_to_a_known_enemy(lua, world, layout, to, rejected):
    lua.execute(layout)
    enemies = lua.eval("require('scripts.threat.enemies')")
    start = lua.table(x=0, y=0)
    assert enemies.on_segment(world.DEPS, world.SURFACE, start, lua.table(x=to[0], y=to[1])) == rejected


def test_the_body_check_cancels_every_job_with_threat_and_rings_body_threat_once(lua, world):
    enqueue(world, {"kind": "wait", "args": {"ticks": 1000}}, {"kind": "wait", "args": {"ticks": 1}})
    run(world, 1)
    threaten(lua, world, 20)
    assert events(world) == [{"kind": "body_threat", "data": {"distance": 20}}]
    assert states(world) == [(1, "cancelled", "threat"), (2, "cancelled", "threat")]
    assert label(world) == "Buddy · Retreating"
    assert dict(world.REQUESTS[1].goal) == {"x": -40, "y": 0}

    game(world, 60)
    assert events(world) == [{"kind": "body_threat", "data": {"distance": 20}}]


@pytest.mark.parametrize(
    ("enemy_x", "end_x", "requests"),
    [
        (20, -35.1, 1),  # the host stands 60 tiles from the enemy: retreat to within 5 tiles of it
        (-10, 0, 0),  # the host stands 30 tiles from the enemy: stop in place
    ],
)
def test_retreat_ends_within_5_tiles_of_the_host_or_stops_where_the_host_is_no_refuge(
    lua, world, enemy_x, end_x, requests
):
    threaten(lua, world, enemy_x)
    if requests:
        answer(lua, world, [-40, 0])
    game(world, 300)
    assert len(world.REQUESTS) == requests
    assert world.BODY.walking_state.walking is False
    assert world.BODY.position.x == pytest.approx(end_x, abs=0.1)
    assert world.storage.threat.retreating is None
    assert label(world) == "Buddy · Standing by"


def retreat_and_lose_the_enemy(lua, world):
    """A retreat from an enemy that is gone before the body arrives; returns the tick the retreat ended."""
    threaten(lua, world, 20)
    answer(lua, world, [-40, 0])
    lua.execute("ENEMIES[1].valid = false")
    for _ in range(400):
        game(world, 1)
        if world.storage.threat.retreating is None:
            return world.DEPS.tick
    raise AssertionError("the retreat never ended")


def test_the_queue_resumes_only_600_quiet_ticks_after_the_retreat(lua, world):
    ended = retreat_and_lose_the_enemy(lua, world)
    enqueue(world, {"kind": "wait", "args": {"ticks": 1}})
    game(world, 599)
    assert states(world) == [(1, "queued", None)]

    game(world, 61)
    (record,) = rpc(world, "jobs", {}, "read")["r"]
    assert record["state"] == "done"
    assert 600 <= record["started_tick"] - ended < 660


def test_idle_follow_resumes_only_600_quiet_ticks_after_the_retreat(lua, world):
    ended = retreat_and_lose_the_enemy(lua, world)
    host_at(lua, -80)
    game(world, 599)
    assert len(world.REQUESTS) == 1

    game(world, 61)
    assert len(world.REQUESTS) == 2
    assert 600 <= world.REQUESTS[2].tick - ended < 660


def test_enemy_damage_rings_body_damaged_at_most_once_per_300_ticks_and_cancels_the_queue(lua, world):
    enqueue(world, {"kind": "wait", "args": {"ticks": 1000}})
    run(world, 1)
    hits = [
        (5, "force = 'neutral'", 245),
        (10, "force = 'enemy'", 240),
        (300, "force = 'enemy'", 230),
        (310, "cause = { valid = true, force = 'enemy' }", 220),
        (610, "force = 'enemy'", 210),
    ]
    for tick, attacker, health in hits:
        world.DEPS.tick = tick
        lua.execute(f"THREAT.on_damaged(DEPS, {{ {attacker}, final_health = {health} }})")
    assert events(world) == [
        {"kind": "body_damaged", "data": {"health": 240}},
        {"kind": "body_damaged", "data": {"health": 220}},
        {"kind": "body_damaged", "data": {"health": 210}},
    ]
    assert states(world) == [(1, "cancelled", "threat")]


def test_idle_follow_never_walks_a_route_into_an_enemy_radius(lua, world):
    host_at(lua, 40)
    lua.execute("enemy(40, 30)")
    world.step(1, world.IDLE.tick)
    answer(lua, world, [40, 0])
    world.step(5, world.IDLE.tick)
    assert world.BODY.walking_state.walking is False
    assert dict(world.BODY.position) == {"x": 0, "y": 0}
    assert label(world) == "Buddy · Waiting for host"
