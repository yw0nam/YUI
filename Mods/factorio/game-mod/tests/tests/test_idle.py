import json

import pytest
from conftest import FIXTURES


@pytest.fixture
def world(lua):
    lua.execute(f'dofile("{FIXTURES / "world.lua"}")')
    return lua.globals()


def rpc(world, op, args, id_="t"):
    request = {"v": 1, "id": id_, "op": op, "args": args, "map_id": "m"}
    world.RPC.dispatch(json.dumps(request), None, world.DEPS)
    return json.loads(list(world.PRINTED.values())[-1])


def events(world):
    out = []
    for event in world.EVENTS.values():
        data = json.loads(world.JSON.encode(event.data))
        out.append({"kind": event.kind, "data": data} if data else {"kind": event.kind})
    return out


def label(world):
    return world.LABEL.text


def host_at(lua, world, x, y):
    world.HOST.position = lua.table(x=x, y=y)


def idle_ticks(world, n):
    world.step(n, world.IDLE.tick)


def answer_path(lua, world, x):
    world.answer(lua.table_from([lua.table_from([x, 0])]), False)


def test_idle_set_switches_mode_pushes_idle_changed_and_feeds_status(world):
    assert rpc(world, "idle_set", {"mode": "follow"})["ok"] is True
    assert events(world) == [{"kind": "idle_changed", "data": {"mode": "follow"}}]
    assert rpc(world, "status", {}, "r1")["r"]["idle"] == {"mode": "follow"}

    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 3, "y": 4}}, "s1")["ok"] is True
    assert rpc(world, "status", {}, "r2")["r"]["idle"] == {"mode": "stay", "pos": {"x": 3, "y": 4}}
    assert events(world) == [
        {"kind": "idle_changed", "data": {"mode": "follow"}},
        {"kind": "idle_changed", "data": {"mode": "stay"}},
    ]


def test_a_repeated_idle_set_replays_without_running_again(world):
    first = rpc(world, "idle_set", {"mode": "follow"}, "w1")
    assert rpc(world, "idle_set", {"mode": "follow"}, "w1") == first
    assert events(world) == [{"kind": "idle_changed", "data": {"mode": "follow"}}]


def test_stay_without_pos_takes_the_body_position_and_stands_there(world):
    assert rpc(world, "idle_set", {"mode": "stay"}, "s2")["ok"] is True
    idle_ticks(world, 2)
    assert world.storage.idle.pos is None
    assert len(world.REQUESTS) == 0
    assert world.BODY.walking_state.walking is False


def test_stay_walks_to_its_position_once_and_then_stands(lua, world):
    assert rpc(world, "idle_set", {"mode": "stay", "pos": {"x": 20, "y": 0}}, "s3")["ok"] is True
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 1
    answer_path(lua, world, 20)

    idle_ticks(world, 300)
    assert world.storage.idle.pos is None
    assert world.BODY.position.x == pytest.approx(18.0, abs=0.2)
    assert world.BODY.walking_state.walking is False


def test_follow_idle_walks_to_the_host_and_rests_within_15_tiles(lua, world):
    host_at(lua, world, 20, 0)
    idle_ticks(world, 2)
    assert len(world.REQUESTS) == 1
    answer_path(lua, world, 20)

    idle_ticks(world, 300)
    assert world.storage.walker is None
    assert world.BODY.position.x == pytest.approx(10.05, abs=0.2)
    assert world.BODY.walking_state.walking is False


def test_beyond_the_leash_the_follow_waits_and_back_inside_it_resumes(lua, world):
    host_at(lua, world, 80, 0)
    idle_ticks(world, 3)
    assert len(world.REQUESTS) == 0
    assert world.BODY.walking_state.walking is False
    assert label(world) == "Buddy · Waiting for host"

    host_at(lua, world, 20, 0)
    idle_ticks(world, 2)
    assert label(world) == "Buddy · Standing by"
    assert len(world.REQUESTS) == 1
    answer_path(lua, world, 20)
    idle_ticks(world, 2)
    assert world.BODY.walking_state.walking is True


def test_idle_set_clears_the_stop_latch(lua, world):
    lua.execute("require('scripts.body').stop(DEPS)")
    assert world.storage.body.stopped is True
    assert events(world) == [{"kind": "stopped"}]

    assert rpc(world, "idle_set", {"mode": "follow"}, "u1")["ok"] is True
    assert world.storage.body.stopped is False
    assert events(world) == [
        {"kind": "stopped"},
        {"kind": "idle_changed", "data": {"mode": "follow"}},
    ]


def test_idle_stays_off_while_a_job_runs_or_the_gate_is_closed(lua, world):
    assert rpc(world, "jobs_enqueue", {"jobs": [{"kind": "wait", "args": {"ticks": 5}}]}, "e1")["ok"] is True
    host_at(lua, world, 20, 0)
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
    host_at(lua, world, 20, 0)
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
        ({}, "mode: follow or stay expected"),
        ({"mode": "walk"}, "mode: follow or stay expected"),
        ({"mode": "stay", "pos": {"x": 1}}, "pos: {x, y} expected"),
        ({"mode": "follow", "pos": "far"}, "pos: {x, y} expected"),
    ],
)
def test_idle_set_refusals_name_the_field(world, args, message):
    assert rpc(world, "idle_set", args) == {"v": 1, "id": "t", "ok": False, "e": "bad_request", "m": message}
    assert world.storage.idle.mode is None
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
    assert world.storage.idle.mode is None
