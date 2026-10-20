import json
import math

import pytest
from conftest import FIXTURES

EAST = 4


@pytest.fixture
def world(lua):
    lua.execute(f'dofile("{FIXTURES / "world.lua"}")')
    return lua.globals()


def rpc(world, op, args, id_="t"):
    request = {"v": 1, "id": id_, "op": op, "args": args, "map_id": "m"}
    world.RPC.dispatch(json.dumps(request), None, world.DEPS)
    return json.loads(list(world.PRINTED.values())[-1])


def status(world):
    return rpc(world, "status", {}, "read")["r"]


def events(world):
    out = []
    for event in world.EVENTS.values():
        data = json.loads(world.JSON.encode(event.data))
        out.append({"kind": event.kind, "data": data} if data else {"kind": event.kind})
    return out


def label(world):
    return world.LABEL.text


def host_at(world, x, y):
    world.HOST.position.x = x
    world.HOST.position.y = y


def idle_ticks(world, n):
    world.step(n, world.IDLE.tick)


def answer_path(lua, world, x):
    world.answer(lua.table_from([lua.table_from([x, 0])]), False)


def test_idle_set_pushes_idle_changed_only_when_the_mode_or_stay_pos_changes(world):
    assert rpc(world, "idle_set", {"mode": "follow"}, "a")["ok"] is True
    assert events(world) == []  # already the start mode

    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 3, "y": 4}}, "b")["ok"] is True
    assert events(world) == [{"kind": "idle_changed", "data": {"mode": "stay"}}]
    assert status(world)["idle"] == {"mode": "stay", "pos": {"x": 3, "y": 4}}

    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 3, "y": 4}}, "c")["ok"] is True
    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 5, "y": 6}}, "d")["ok"] is True
    assert [event["data"] for event in events(world)] == [{"mode": "stay"}, {"mode": "stay"}]
    assert status(world)["idle"] == {"mode": "stay", "pos": {"x": 5, "y": 6}}

    assert rpc(world, "idle_set", {"mode": "follow"}, "e")["ok"] is True
    assert [event["data"] for event in events(world)][-1] == {"mode": "follow"}
    assert status(world)["idle"] == {"mode": "follow"}


def test_stay_without_pos_takes_the_body_position_and_stands_there(world):
    assert rpc(world, "idle_set", {"mode": "stay"}, "s2")["ok"] is True
    assert status(world)["idle"] == {"mode": "stay", "pos": {"x": 0, "y": 0}}
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 0
    assert world.BODY.walking_state.walking is False
    assert status(world)["idle"] == {"mode": "stay", "pos": {"x": 0, "y": 0}}


def test_stay_walks_to_its_position_once_and_then_stands(lua, world):
    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 20, "y": 0}}, "s3")["ok"] is True
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 1
    answer_path(lua, world, 20)

    idle_ticks(world, 300)
    assert world.BODY.walking_state.walking is False
    assert math.dist((world.BODY.position.x, world.BODY.position.y), (20, 0)) <= 2
    assert status(world)["idle"] == {"mode": "stay", "pos": {"x": 20, "y": 0}}


def test_follow_idle_walks_to_the_host_and_rests_within_15_tiles(lua, world):
    host_at(world, 20, 0)
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 1
    answer_path(lua, world, 20)

    idle_ticks(world, 300)
    assert world.storage.walker is None
    assert world.BODY.position.x == pytest.approx(10.05, abs=0.2)
    assert world.BODY.walking_state.walking is False


def test_a_step_ends_at_once_when_the_host_comes_within_reach(lua, world):
    host_at(world, 40, 0)
    idle_ticks(world, 2)
    answer_path(lua, world, 40)
    idle_ticks(world, 20)
    assert world.BODY.walking_state.walking is True

    host_at(world, 5, 0)
    idle_ticks(world, 1)
    assert world.BODY.walking_state.walking is False
    assert world.storage.walker is None


def test_a_host_on_another_surface_counts_as_beyond_the_leash(lua, world):
    host_at(world, 20, 0)
    lua.execute("HOST.physical_surface = {}")
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 0
    assert world.BODY.walking_state.walking is False
    assert label(world) == "Buddy · Waiting for host"


def test_beyond_the_leash_the_follow_waits_and_back_inside_it_resumes(lua, world):
    host_at(world, 80, 0)
    idle_ticks(world, 3)
    assert len(world.REQUESTS) == 0
    assert world.BODY.walking_state.walking is False
    assert label(world) == "Buddy · Waiting for host"

    host_at(world, 20, 0)
    idle_ticks(world, 2)
    assert label(world) == "Buddy · Standing by"
    assert len(world.REQUESTS) == 1
    answer_path(lua, world, 20)
    idle_ticks(world, 2)
    assert world.BODY.walking_state.walking is True


def test_three_failed_steps_wait_600_ticks_and_ask_for_the_host(lua, world):
    host_at(world, 40, 0)
    world.BLOCKED[EAST] = True
    idle_ticks(world, 1)
    for _step in range(3):
        for _request in range(6):
            world.step_until_request(world.IDLE.tick)
            world.answer(None, False)
        idle_ticks(world, 1)
    assert label(world) == "Buddy · Waiting for host"
    assert world.storage.idle.retry_tick == world.DEPS.tick + 600
    requests_after_three_steps = len(world.REQUESTS)

    idle_ticks(world, 400)
    assert len(world.REQUESTS) == requests_after_three_steps
    assert label(world) == "Buddy · Waiting for host"

    world.DEPS.tick = world.DEPS.tick + 601
    idle_ticks(world, 1)
    assert len(world.REQUESTS) == requests_after_three_steps + 1
    assert label(world) == "Buddy · Standing by"


@pytest.mark.parametrize(
    ("disturb", "restore"),
    [
        (
            "HOST = nil",
            (
                "HOST = { name = 'host' } HOST.position = { x = 40, y = 0 } "
                "HOST.physical_position = HOST.position HOST.physical_surface = SURFACE"
            ),
        ),
        ("BODY.valid = false", "BODY.valid = true"),
    ],
)
def test_a_shut_gate_takes_the_idle_walk_away_at_once(lua, world, disturb, restore):
    host_at(world, 40, 0)
    idle_ticks(world, 1)
    answer_path(lua, world, 40)
    idle_ticks(world, 3)
    assert world.BODY.walking_state.walking is True

    lua.execute(disturb)
    idle_ticks(world, 1)
    assert world.BODY.walking_state.walking is False
    assert world.storage.walker is None
    assert len(world.REQUESTS) == 1

    lua.execute(restore)
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 2  # a fresh step, never the old path


def test_leaving_the_leash_by_idle_set_resets_the_label(lua, world):
    host_at(world, 80, 0)
    idle_ticks(world, 2)
    assert label(world) == "Buddy · Waiting for host"
    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 1, "y": 0}}, "s")["ok"] is True
    assert label(world) == "Buddy · Standing by"


def test_the_start_setting_drives_the_mode(world):
    world.DEPS.start_mode = "stay"
    host_at(world, 40, 0)
    idle_ticks(world, 3)
    assert len(world.REQUESTS) == 0  # a stay start stands however far the host is
    assert status(world)["idle"] == {"mode": "stay"}
    assert label(world) == "Buddy · Standing by"


def test_a_setting_change_moves_the_mode_and_rings_while_no_idle_set_is_in_force(lua, world):
    lua.execute("settings = { global = { ['coop-agent-idle-start'] = { value = 'stay' } } }")
    world.DEPS.start_mode = "stay"
    world.IDLE.on_setting_changed_event(lua.table(setting="coop-agent-idle-start"))
    assert events(world) == [{"kind": "idle_changed", "data": {"mode": "stay"}}]
    assert status(world)["idle"] == {"mode": "stay"}
    idle_ticks(world, 3)
    assert len(world.REQUESTS) == 0  # the new start mode applies at once

    assert rpc(world, "idle_set", {"mode": "follow"}, "pin")["ok"] is True
    world.IDLE.on_setting_changed_event(lua.table(setting="coop-agent-idle-start"))
    assert events(world) == [{"kind": "idle_changed", "data": {"mode": "stay"}}]
    assert status(world)["idle"] == {"mode": "follow"}


def test_idle_set_clears_the_stop_latch(lua, world):
    lua.execute("require('scripts.body').stop(DEPS)")
    assert world.storage.body.stopped is True
    assert events(world) == [{"kind": "stopped"}]

    assert rpc(world, "idle_set", {"mode": "follow"}, "u1")["ok"] is True
    assert world.storage.body.stopped is False
    assert events(world) == [{"kind": "stopped"}]  # follow is already the start mode: silent


def test_an_idle_set_settles_a_halted_queue_before_it_lifts_the_latch(lua, world):
    host_at(world, 20, 0)
    assert (
        rpc(
            world,
            "jobs_enqueue",
            {
                "jobs": [
                    {"kind": "walk_to", "args": {"pos": {"x": 20, "y": 0}, "radius": 1}},
                    {"kind": "wait", "args": {"ticks": 5}},
                ]
            },
            "e",
        )["ok"]
        is True
    )
    world.step(1, world.JOBS.tick)
    answer_path(lua, world, 20)
    world.step(2, world.JOBS.tick)
    assert world.BODY.walking_state.walking is True

    lua.execute("require('scripts.body').stop(DEPS)")
    assert rpc(world, "idle_set", {"mode": "follow"}, "u")["ok"] is True
    assert world.storage.body.stopped is False
    assert world.BODY.walking_state.walking is False
    assert [(job["id"], job["state"], job["reason"]) for job in rpc(world, "jobs", {}, "j")["r"]] == [
        (1, "failed", "stopped"),
        (2, "cancelled", "cancelled"),
    ]
    assert events(world) == [
        {"kind": "stopped"},
        {"kind": "job_failed", "data": {"id": 1, "kind": "walk_to", "reason": "stopped"}},
    ]


def test_idle_stays_off_while_a_job_runs_or_the_gate_is_closed(lua, world):
    assert rpc(world, "jobs_enqueue", {"jobs": [{"kind": "wait", "args": {"ticks": 5}}]}, "e1")["ok"] is True
    host_at(world, 20, 0)
    idle_ticks(world, 3)
    assert len(world.REQUESTS) == 0
    assert world.storage.walker is None

    world.step(6, world.JOBS.tick)
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 1

    lua.execute("require('scripts.body').stop(DEPS)")
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 1
    assert world.BODY.walking_state.walking is False


def test_an_enqueue_takes_the_body_from_idle_and_stops_its_walk(lua, world):
    host_at(world, 20, 0)
    idle_ticks(world, 1)
    assert len(world.REQUESTS) == 1
    answer_path(lua, world, 20)
    idle_ticks(world, 3)
    assert world.BODY.walking_state.walking is True

    assert rpc(world, "jobs_enqueue", {"jobs": [{"kind": "wait", "args": {"ticks": 5}}]}, "e2")["ok"] is True
    assert world.BODY.walking_state.walking is False
    world.step(2, world.JOBS.tick)
    assert world.BODY.walking_state.walking is False


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({}, "mode: one of follow, stay expected"),
        ({"mode": "walk"}, "mode: one of follow, stay expected"),
        ({"mode": "follow", "pos": {"x": 1, "y": 2}}, "pos: only the stay mode takes a pos"),
        ({"mode": "stay", "pos": {"x": 1}}, "pos: {x, y} expected"),
        ({"mode": "stay", "pos": "far"}, "pos: {x, y} expected"),
    ],
)
def test_idle_set_refusals_name_the_field(world, args, message):
    assert rpc(world, "idle_set", args) == {"v": 1, "id": "t", "ok": False, "e": "bad_request", "m": message}
    assert status(world)["idle"] == {"mode": "follow"}
    assert events(world) == []


def test_stay_without_pos_needs_a_live_body(world):
    world.BODY.valid = False
    assert rpc(world, "idle_set", {"mode": "stay"}) == {
        "v": 1,
        "id": "t",
        "ok": False,
        "e": "bad_request",
        "m": "pos: a live body or pos expected",
    }
    assert status(world)["idle"] == {"mode": "follow"}
