import pytest

EAST = 4


def go(lua, world, x, y, radius=1):
    world.WALKER.go(world.DEPS, lua.table(x=x, y=y), radius)


def walk(world, n):
    return world.step(n, world.WALKER.tick)


def until_request(world):
    return world.step_until_request(world.WALKER.tick)


def answer(lua, world, points=None, try_again_later=False):
    world.answer(lua.table_from([lua.table_from(p) for p in points]) if points else None, try_again_later)


def walking(world):
    return world.BODY.walking_state.walking, world.BODY.walking_state.direction


def test_a_path_request_carries_the_body_shape_and_ignores_the_body(lua, world):
    go(lua, world, 10, 0)
    until_request(world)
    spec = world.REQUESTS[1]
    assert lua.eval("REQUESTS[1].entity_to_ignore == BODY") is True
    assert dict(spec.pathfind_flags) == {"cache": False}
    assert (dict(spec.start), dict(spec.goal)) == ({"x": 0, "y": 0}, {"x": 10, "y": 0})
    assert (
        spec.bounding_box,
        spec.collision_mask,
        spec.force,
        spec.radius,
        spec.can_open_gates,
        spec.path_resolution_modifier,
    ) == ("box", "mask", "player", 2, True, 0)


@pytest.mark.parametrize("try_again_later", [True, False])
def test_failed_requests_retry_after_30_ticks_finer_and_the_6th_failure_is_no_path(
    lua, world, try_again_later
):
    go(lua, world, 10, 0)
    sent = []
    for index in range(1, 7):
        until_request(world)
        spec = world.REQUESTS[index]
        sent.append((spec.tick, spec.path_resolution_modifier))
        answer(lua, world, None, try_again_later)

    assert sent == [(1, 0), (31, 0), (61, 1), (91, 1), (121, 2), (151, 2)]
    assert walk(world, 1) == ("no_path", 152)
    assert world.BODY.walking_state.walking is False


def test_a_stale_path_result_is_dropped(lua, world):
    go(lua, world, -10, 0)
    until_request(world)
    world.WALKER.cancel(world.DEPS)
    go(lua, world, 10, 0)
    until_request(world)

    stale = lua.table_from([lua.table(position=lua.table(x=-10, y=0))])
    world.WALKER.on_path_finished(world.DEPS, lua.table(id=1, path=stale, try_again_later=False))
    walk(world, 5)
    assert (walking(world)[0], dict(world.BODY.position)) == (False, {"x": 0, "y": 0})

    answer(lua, world, [[10, 0]])
    walk(world, 1)
    assert walking(world) == (True, EAST)


def test_a_stall_repaths_once_from_2_tiles_back_and_600_still_ticks_step_back_and_fail_stuck(lua, world):
    world.BLOCKED[EAST] = True
    go(lua, world, 10, 0)
    until_request(world)
    answer(lua, world, [[10, 0]])

    assert until_request(world) == 152
    assert dict(world.REQUESTS[2].start) == {"x": -2, "y": 0}
    assert world.BODY.walking_state.walking is False
    answer(lua, world, [[10, 0]])

    assert walk(world, 1000) == ("stuck", 616)
    assert world.BODY.position.x == pytest.approx(-2.1)
    assert world.BODY.walking_state.walking is False
    assert len(world.REQUESTS) == 2


def test_a_route_hook_that_rejects_fails_the_walk_with_its_reason(lua, world):
    lua.execute('DEPS.on_path = function() return "threat" end')
    go(lua, world, 10, 0)
    until_request(world)
    answer(lua, world, [[10, 0]])
    assert walk(world, 5) == ("threat", 2)
    assert world.BODY.walking_state.walking is False


def test_cancel_stops_walking_and_leaves_mining_and_crafts(lua, world):
    go(lua, world, 10, 0)
    until_request(world)
    answer(lua, world, [[10, 0]])
    walk(world, 2)
    lua.execute(
        "CANCELLED = {} BODY.mining_state = { mining = true } "
        "BODY.crafting_queue_size = 1 BODY.crafting_queue = { { count = 2 } } "
        "BODY.cancel_crafting = function(spec) CANCELLED[#CANCELLED + 1] = spec BODY.crafting_queue_size = 0 end"
    )

    world.WALKER.cancel(world.DEPS)
    assert world.BODY.walking_state.walking is False
    assert world.BODY.mining_state.mining is True
    assert list(world.CANCELLED.values()) == []
