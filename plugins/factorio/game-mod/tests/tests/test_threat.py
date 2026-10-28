import math

import pytest
from conftest import events, rpc, run

THREAT_FAILED = [{"kind": "job_failed", "data": {"id": 1, "kind": "walk_to", "reason": "threat"}}]


@pytest.fixture
def world(lua, world):
    # the walker hooks on DEPS, and one game tick as control.lua wires it: the 60-tick sweep, then the runner,
    # idle and the retreat
    lua.execute(
        "THREAT = require('scripts.threat') THREAT.with_route_checks(DEPS) "
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


def body_at(world):
    return (world.BODY.position.x, world.BODY.position.y)


def failed(kind, id_=1):
    return {"kind": "job_failed", "data": {"id": id_, "kind": kind, "reason": "threat"}}


def next_sweep(world):
    """Game ticks up to and including the next 60-tick sweep."""
    game(world, 60 - world.DEPS.tick % 60)


@pytest.mark.parametrize(
    ("layout", "ends", "walking"),
    [
        ("enemy(50, 40)", THREAT_FAILED, False),  # the route's midpoint passes 40 tiles from it
        (
            "enemy(52, 51)",
            THREAT_FAILED,
            False,
        ),  # 51 tiles from the route: only the safe radius + 4 reaches it
        ("", [], True),
    ],
)
def test_a_route_that_passes_an_enemy_is_rejected(lua, world, layout, ends, walking):
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
    assert events(world) == [failed(job["kind"])]
    assert len(world.REQUESTS) == 0
    assert body_at(world) == (0, 0)


def test_a_replacement_mine_target_within_the_safe_radius_of_an_enemy_fails_threat(lua, world):
    # the first tree is 82 tiles from the enemy, the second 40
    lua.execute("place('tree-01', 2, 0) place('tree-01', -40, 0) enemy(-80, 0)")
    enqueue(world, {"kind": "mine", "args": {"name": "wood", "count": 8}})
    run(world, 200)
    assert events(world) == [failed("mine")]
    assert len(world.REQUESTS) == 0


@pytest.mark.parametrize(
    ("layout", "to", "closer"),
    [
        ("enemy(0, -10)", (0, 5), False),  # straight away: the start stays the nearest point
        ("enemy(0, -10)", (5, 0), False),  # across: the start stays the nearest point
        ("enemy(0, -10)", (0, -5), True),  # straight toward
        ("enemy(0, -10)", (5, -1), True),  # slightly toward
        ("enemy(0, -60)", (0, -5), False),  # beyond the safe radius + 4 of the start
        ("enemy(0, -10, 'neutral')", (0, -5), False),  # not an enemy force
    ],
)
def test_a_segment_counts_only_when_it_comes_closer_to_a_known_enemy(lua, world, layout, to, closer):
    lua.execute(layout)
    enemies = lua.eval("require('scripts.threat.enemies')")
    route = lua.table_from([lua.table(x=to[0], y=to[1])])
    assert enemies.ahead_closer(world.DEPS, world.SURFACE, lua.table(x=0, y=0), route, 1) is closer


@pytest.mark.parametrize(
    ("started", "ends", "after"),
    [
        (True, [failed("wait")], [(1, "failed", "threat"), (2, "cancelled", "threat")]),
        (False, [], [(1, "cancelled", "threat"), (2, "cancelled", "threat")]),
    ],
)
def test_the_body_check_fails_the_running_job_cancels_the_queue_and_rings_body_threat_once(
    lua, world, started, ends, after
):
    enqueue(world, {"kind": "wait", "args": {"ticks": 1000}}, {"kind": "wait", "args": {"ticks": 1}})
    if started:
        run(world, 1)
    threaten(lua, world, 20)
    assert events(world) == [{"kind": "body_threat", "data": {"distance": 20}}, *ends]
    assert states(world) == after
    assert label(world) == "Buddy · Retreating"
    assert dict(world.REQUESTS[len(world.REQUESTS)].goal) == {"x": -40, "y": 0}

    game(world, 60)
    assert events(world) == [{"kind": "body_threat", "data": {"distance": 20}}, *ends]


def test_body_threat_rings_on_the_first_sighting_after_damage_raised_the_alarm(lua, world):
    host_at(lua, -40)
    lua.execute("enemy(20, 0)")
    world.DEPS.tick = 10
    lua.execute("THREAT.on_damaged(DEPS, { force = 'enemy', final_health = 240 })")
    next_sweep(world)
    assert events(world) == [
        {"kind": "body_damaged", "data": {"health": 240}},
        {"kind": "body_threat", "data": {"distance": 20}},
    ]


@pytest.mark.parametrize(
    ("enemy_x", "near", "within", "requests"),
    [
        (20, (-40, 0), 5, 1),  # the host stands 60 tiles from the enemy: retreat to within 5 tiles of it
        (-10, (0, 0), 0, 0),  # the host stands 30 tiles from the enemy: stop in place
    ],
)
def test_retreat_ends_within_5_tiles_of_the_host_or_stops_where_the_host_is_no_refuge(
    lua, world, enemy_x, near, within, requests
):
    threaten(lua, world, enemy_x)
    if requests:
        answer(lua, world, [-40, 0])
    game(world, 300)
    assert len(world.REQUESTS) == requests
    assert world.BODY.walking_state.walking is False
    assert math.dist(body_at(world), near) <= within
    assert label(world) == "Buddy · Standing by"


def test_a_rejected_retreat_route_stands_keeps_retreating_and_retries_every_300_ticks(lua, world):
    threaten(lua, world, 20)
    seen, labels = [], set()
    for _ in range(700):
        if len(world.REQUESTS) > len(seen):
            seen.append(world.REQUESTS[len(world.REQUESTS)].tick)
            answer(lua, world, [5, 0], [-40, 0])  # its first segment heads toward the enemy
        game(world, 1)
        labels.add(label(world))
    # each retry goes out 300 ticks after the rejection, one tick after the answer
    assert seen == [60, 361, 662]
    assert labels == {"Buddy · Retreating"}
    assert body_at(world) == (0, 0)


def test_a_retreat_retry_stands_in_place_when_an_enemy_now_stands_near_the_host(lua, world):
    threaten(lua, world, 20)
    answer(lua, world, [5, 0], [-40, 0])  # its first segment heads toward the enemy
    game(world, 1)
    lua.execute("enemy(-40, 30)")  # 30 tiles from the host, 50 from the body
    game(world, 340)
    assert len(world.REQUESTS) == 1
    assert label(world) == "Buddy · Standing by"
    assert body_at(world) == (0, 0)


def test_the_retreat_follows_a_host_that_moved_more_than_5_tiles(lua, world):
    threaten(lua, world, 20)
    answer(lua, world, [-40, 0])
    game(world, 30)
    lua.execute("HOST.position = { x = -40, y = 30 }")
    next_sweep(world)
    assert len(world.REQUESTS) == 2
    assert dict(world.REQUESTS[2].goal) == {"x": -40, "y": 30}


@pytest.mark.parametrize("walker", ["job", "follow"])
def test_the_look_ahead_catches_an_enemy_that_moves_onto_the_route(lua, world, walker):
    goal = 100 if walker == "job" else 60  # a follow step walks only inside the 64-tile leash
    if walker == "job":
        enqueue(world, walk_to(goal, 0))
    else:
        host_at(lua, goal)
    game(world, 1)
    answer(lua, world, [goal, 0])
    game(world, 9)
    # 51 tiles beside the route 10 tiles ahead: past the body check's 48, inside the look-ahead's 52
    lua.execute(f"enemy({world.BODY.position.x + 10}, 51)")
    game(world, 51)
    assert events(world) == ([failed("walk_to")] if walker == "job" else [])
    assert world.BODY.walking_state.walking is False
    assert label(world) == ("Buddy · Standing by" if walker == "job" else "Buddy · Waiting for host")


def retreat_and_lose_the_enemy(lua, world):
    """A retreat from an enemy that is gone before the body arrives; returns the tick the retreat ended."""
    threaten(lua, world, 20)
    answer(lua, world, [-40, 0])
    lua.execute("ENEMIES[1].valid = false")
    for _ in range(400):
        game(world, 1)
        if label(world) == "Buddy · Standing by":
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


def test_a_new_sighting_in_the_quiet_period_starts_it_again(lua, world):
    retreat_and_lose_the_enemy(lua, world)
    game(world, 300)
    lua.execute("enemy(-35, 30)")  # 30 tiles from the host: the body stands where it is
    next_sweep(world)
    sighted = world.DEPS.tick
    lua.execute("ENEMIES[2].valid = false")
    host_at(lua, -80)
    game(world, 599)
    assert len(world.REQUESTS) == 1

    game(world, 61)
    assert len(world.REQUESTS) == 2
    assert 600 <= world.REQUESTS[2].tick - sighted < 660


def test_a_stay_body_walks_back_to_its_position_once_the_quiet_period_ends(lua, world):
    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 0, "y": 0}}, "s")["ok"] is True
    world.step(2, world.IDLE.tick)
    retreat_and_lose_the_enemy(lua, world)
    game(world, 660)
    assert len(world.REQUESTS) == 2
    assert dict(world.REQUESTS[2].goal) == {"x": 0, "y": 0}


def test_enemy_damage_rings_body_damaged_at_most_once_per_300_ticks_and_fails_the_running_job(lua, world):
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
        failed("wait"),
        {"kind": "body_damaged", "data": {"health": 220}},
        {"kind": "body_damaged", "data": {"health": 210}},
    ]
    assert states(world) == [(1, "failed", "threat")]


def test_damage_while_the_gate_is_shut_rings_but_holds_nothing(lua, world):
    lua.execute("require('scripts.body').stop(DEPS)")
    lua.execute("THREAT.on_damaged(DEPS, { force = 'enemy', final_health = 240 })")
    assert rpc(world, "idle_set", {"mode": "follow"}, "u")["ok"] is True
    enqueue(world, {"kind": "wait", "args": {"ticks": 1}})
    game(world, 2)
    assert events(world) == [
        {"kind": "stopped"},
        {"kind": "body_damaged", "data": {"health": 240}},
        {"kind": "job_done", "data": {"id": 1, "kind": "wait"}},
        {"kind": "queue_idle", "data": {"last_job_id": 1}},
    ]
    assert len(world.REQUESTS) == 0


def test_idle_follow_never_walks_a_route_into_an_enemy_radius(lua, world):
    host_at(lua, 40)
    lua.execute("enemy(40, 30)")
    world.step(1, world.IDLE.tick)
    answer(lua, world, [40, 0])
    world.step(5, world.IDLE.tick)
    assert world.BODY.walking_state.walking is False
    assert body_at(world) == (0, 0)
    assert label(world) == "Buddy · Waiting for host"
