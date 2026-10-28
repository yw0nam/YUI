import pytest
from conftest import events, rpc, run


def mine(world, timeout_ticks=None, **args):
    job = {"kind": "mine", "args": args}
    if timeout_ticks is not None:
        job["timeout_ticks"] = timeout_ticks
    assert rpc(world, "jobs_enqueue", {"jobs": [job]})["ok"] is True


def job(world):
    (record,) = rpc(world, "jobs", {}, "read")["r"]
    return record


DONE = [
    {"kind": "job_done", "data": {"id": 1, "kind": "mine"}},
    {"kind": "queue_idle", "data": {"last_job_id": 1}},
]


def failed(reason):
    return [{"kind": "job_failed", "data": {"id": 1, "kind": "mine", "reason": reason}}]


NAMED = "require('scripts.unit_index').add"


@pytest.mark.parametrize(
    ("layout", "args", "ends", "kept"),
    [
        ("place('coal', 2, 0)", {"name": "coal", "count": 1}, DONE, []),
        ("place('tree-01', 2, 0)", {"name": "wood", "count": 1}, DONE, []),
        ("place('huge-rock', 2, 0)", {"name": "stone", "count": 1}, DONE, []),
        ("place('stone-furnace', 2, 0, true)", {"name": "stone-furnace", "count": 1}, DONE, []),
        ("place('stone-furnace', 2, 0)", {"name": "stone-furnace", "count": 1}, failed("target_gone"), []),
        (
            f"{NAMED}(place('stone-furnace', 2, 0))",
            {"name": "stone-furnace", "count": 1, "entity": 100},
            failed("not_permitted"),
            [],
        ),
        # the unmarked furnace is nearer, the marked one is mined
        (
            "place('stone-furnace', 1, 0) place('stone-furnace', 2, 0, true)",
            {"name": "stone-furnace", "count": 1},
            DONE,
            [1],
        ),
        ("place('coal', 65, 0)", {"name": "coal", "count": 1}, failed("target_gone"), []),
        (
            f"{NAMED}(place('stone-furnace', 65, 0, true))",
            {"name": "stone-furnace", "count": 1, "entity": 100},
            failed("unreachable"),
            [],
        ),
        ("place('tree-01', 2, 0)", {"name": "coal", "count": 1}, failed("target_gone"), []),
        # a resource that needs a fluid cannot be mined by hand
        ("place('uranium-ore', 2, 0)", {"name": "uranium-ore", "count": 1}, failed("target_gone"), []),
        (
            f"local ore = place('uranium-ore', 2, 0) ore.unit_number = 100 {NAMED}(ore)",
            {"name": "uranium-ore", "count": 1, "entity": 100},
            failed("unsupported"),
            [],
        ),
        # the rock flag counts on a simple-entity only
        (
            (
                "PROTOTYPES['stone-furnace'].count_as_rock_for_filtered_deconstruction = true "
                "place('stone-furnace', 2, 0)"
            ),
            {"name": "stone-furnace", "count": 1},
            failed("target_gone"),
            [],
        ),
    ],
)
def test_the_target_is_the_nearest_allowed_entity_that_yields_the_item(lua, world, layout, args, ends, kept):
    lua.execute(layout)
    mine(world, **args)
    run(world, 500)
    assert events(world) == ends
    assert [world.ENTITIES[index].valid for index in kept] == [True] * len(kept)


def test_mining_walks_to_each_target_and_ends_on_the_inventory_delta(lua, world):
    lua.execute("INVENTORY.wood = 1 place('tree-01', 2, 0) place('tree-01', 5, 0)")
    mine(world, name="wood", count=5)
    run(world, 1)
    assert world.LABEL.text == "Buddy · Mining wood 0/5"

    world.step_until_request(world.JOBS.tick)
    assert world.LABEL.text == "Buddy · Mining wood 4/5"
    assert dict(world.REQUESTS[1].goal) == {"x": 5, "y": 0}
    world.answer(lua.table_from([lua.table_from([5, 0])]), False)

    run(world, 300)
    assert events(world) == DONE
    assert job(world)["progress"] == {"gained": 8, "count": 5, "path": "native"}
    assert world.INVENTORY.wood == 9
    assert world.LABEL.text == "Buddy · Holding: wood 9"
    assert world.BODY.mining_state.mining is False


def test_no_progress_for_twice_the_mining_time_falls_back_to_timed_mining(lua, world):
    lua.execute("NATIVE = false place('coal', 2, 0)")
    mine(world, name="coal", count=2)
    run(world, 230)
    assert job(world)["progress"] == {"gained": 0, "count": 2, "path": "native"}
    assert world.BODY.mining_state.mining is True

    # twice the 120 mining ticks, seen at the next 30-tick check
    run(world, 40)
    assert job(world)["progress"]["path"] == "timed"
    assert world.BODY.mining_state.mining is False

    run(world, 300)
    mined = list(world.MINED.values())
    assert len(mined) == 2
    assert 360 <= mined[0] <= 390
    assert events(world) == DONE
    assert job(world)["progress"] == {"gained": 2, "count": 2, "path": "timed"}


def test_a_full_inventory_fails_target_full(lua, world):
    lua.execute("place('coal', 2, 0)")
    mine(world, name="coal", count=5)
    run(world, 130)
    lua.execute("FULL = true")
    run(world, 30)
    assert events(world) == failed("target_full")
    assert job(world)["progress"] == {"gained": 1, "count": 5, "path": "native"}
    assert world.BODY.mining_state.mining is False


@pytest.mark.parametrize(
    "end",
    [
        "run",
        "FULL = true",
        "require('scripts.jobs').cancel(DEPS, nil)",
    ],
)
def test_every_end_of_a_mine_job_drops_its_state(lua, world, end):
    lua.execute("place('coal', 2, 0)")
    mine(world, name="coal", count=1)
    run(world, 1)
    assert world.storage.jobs.kind_state is not None

    if end != "run":
        lua.execute(end)
    run(world, 200)
    assert world.storage.jobs.active == 0
    assert world.storage.jobs.kind_state is None


def test_a_target_removed_by_another_actor_is_replaced_once_then_target_gone(lua, world):
    lua.execute("A = place('coal', 2, 0) B = place('coal', 0, 2.5) C = place('coal', -2.6, 0)")
    mine(world, name="coal", count=5)
    run(world, 1)
    assert lua.eval("BODY.selected == A") is True

    lua.execute("A.valid = false")
    run(world, 31)
    assert lua.eval("BODY.selected == B") is True
    assert events(world) == []

    lua.execute("B.valid = false")
    run(world, 30)
    assert events(world) == failed("target_gone")
    assert lua.eval("BODY.selected == C") is False


@pytest.mark.parametrize(
    ("setup", "args", "timeout_ticks", "expected"),
    [
        ("place('coal', 2, 0)", {"name": "coal", "count": 10}, None, 7200),
        ("place('coal', 2, 0)", {"name": "coal", "count": 1000}, None, 36000),
        ("place('huge-rock', 2, 0)", {"name": "stone", "count": 5}, None, 9000),
        (
            "place('coal', 2, 0) BODY.character_mining_speed_modifier = 1",
            {"name": "coal", "count": 10},
            None,
            5400,
        ),
        (
            "place('coal', 2, 0) DEPS.force.manual_mining_speed_modifier = 1",
            {"name": "coal", "count": 10},
            None,
            5400,
        ),
        ("place('coal', 2, 0)", {"name": "coal", "count": 10}, 50, 50),
    ],
)
def test_the_default_timeout_is_a_walk_allowance_plus_three_times_the_mining_time_capped(
    lua, world, setup, args, timeout_ticks, expected
):
    lua.execute(setup)
    mine(world, timeout_ticks, **args)
    run(world, 1)
    assert job(world)["timeout_ticks"] == expected
