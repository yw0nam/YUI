import json

import pytest
from conftest import FIXTURES

WAIT_1 = {"kind": "wait", "args": {"ticks": 1}}
WALK_EAST = {"kind": "walk_to", "args": {"pos": {"x": 3, "y": 0}, "radius": 0.5}}


@pytest.fixture
def world(lua):
    lua.execute(f'dofile("{FIXTURES / "world.lua"}")')
    return lua.globals()


def rpc(world, op, args, id_="t"):
    request = {"v": 1, "id": id_, "op": op, "args": args, "map_id": "m"}
    world.RPC.dispatch(json.dumps(request), None, world.DEPS)
    return json.loads(list(world.PRINTED.values())[-1])


def enqueue(world, *jobs, id_="t"):
    return rpc(world, "jobs_enqueue", {"jobs": list(jobs)}, id_)


def run(world, n):
    world.step(n, world.JOBS.tick)


def events(world):
    out = []
    for event in world.EVENTS.values():
        data = json.loads(world.JSON.encode(event.data))
        out.append({"kind": event.kind, "data": data} if data else {"kind": event.kind})
    return out


def states(world):
    return [(job["id"], job["state"], job.get("reason")) for job in rpc(world, "jobs", {}, "read")["r"]]


def answer_east(lua, world):
    world.answer(lua.table_from([lua.table_from([3, 0])]), False)


def test_walk_to_walks_the_path_ends_done_and_the_queue_goes_idle(lua, world):
    assert enqueue(world, WALK_EAST) == {"v": 1, "id": "t", "ok": True, "r": {"ids": [1]}}
    run(world, 1)
    assert world.LABEL.text == "Buddy · Walking to 3,0"
    answer_east(lua, world)

    run(world, 30)
    assert events(world) == [
        {"kind": "job_done", "data": {"id": 1, "kind": "walk_to"}},
        {"kind": "queue_idle", "data": {"last_job_id": 1}},
    ]
    assert world.BODY.position.x == pytest.approx(2.55)
    assert world.BODY.walking_state.walking is False
    assert world.LABEL.text == "Buddy · Standing by"
    assert states(world) == [(1, "done", None)]


def test_queue_idle_follows_only_the_last_done_job(world):
    enqueue(world, WAIT_1, {"kind": "wait", "args": {"ticks": 3}})
    run(world, 10)
    assert events(world) == [
        {"kind": "job_done", "data": {"id": 1, "kind": "wait"}},
        {"kind": "job_done", "data": {"id": 2, "kind": "wait"}},
        {"kind": "queue_idle", "data": {"last_job_id": 2}},
    ]


def test_a_timeout_fails_the_job_cancels_the_rest_and_wakes_once(world):
    enqueue(world, {"kind": "wait", "args": {"ticks": 10}, "timeout_ticks": 3}, WAIT_1, WALK_EAST)
    run(world, 3)
    assert states(world) == [(1, "running", None), (2, "queued", None), (3, "queued", None)]

    run(world, 1)
    assert events(world) == [{"kind": "job_failed", "data": {"id": 1, "kind": "wait", "reason": "timeout"}}]
    assert states(world) == [
        (1, "failed", "timeout"),
        (2, "cancelled", "cancelled"),
        (3, "cancelled", "cancelled"),
    ]


@pytest.mark.parametrize(
    ("disturb", "reason", "before"),
    [
        ("require('scripts.body').stop(DEPS)", "stopped", [{"kind": "stopped"}]),
        ("HOST = nil", "stopped", []),
        ("BODY.valid = false", "body_dead", []),
        ("CHEST.valid = false", "target_gone", []),
    ],
)
def test_the_gate_and_a_lost_target_end_the_walk_at_once(lua, world, disturb, reason, before):
    lua.execute(
        "CHEST = { valid = true, unit_number = 99, name = 'wooden-chest', position = { x = 3, y = 0 } } "
        "require('scripts.unit_index').add(CHEST)"
    )
    enqueue(world, {"kind": "walk_to", "args": {"entity": 99, "radius": 0.5}}, WAIT_1)
    run(world, 1)
    answer_east(lua, world)
    run(world, 2)
    assert world.BODY.walking_state.walking is True

    lua.execute(disturb)
    run(world, 1)
    failed = {"kind": "job_failed", "data": {"id": 1, "kind": "walk_to", "reason": reason}}
    assert events(world) == [*before, failed]
    assert states(world) == [(1, "failed", reason), (2, "cancelled", "cancelled")]
    # a dead body's entity is invalid and has no walking state to read
    if world.BODY.valid:
        assert world.BODY.walking_state.walking is False


def test_an_enqueue_after_a_stop_in_the_same_tick_still_cancels_the_old_queue_and_lifts_the_latch(lua, world):
    enqueue(world, WALK_EAST, id_="a")
    run(world, 1)
    lua.execute("require('scripts.body').stop(DEPS)")
    assert enqueue(world, WAIT_1, id_="b")["r"] == {"ids": [2]}
    assert world.storage.body.stopped is False

    run(world, 2)
    assert events(world) == [
        {"kind": "stopped"},
        {"kind": "job_failed", "data": {"id": 1, "kind": "walk_to", "reason": "stopped"}},
        {"kind": "job_done", "data": {"id": 2, "kind": "wait"}},
        {"kind": "queue_idle", "data": {"last_job_id": 2}},
    ]


def test_cancel_all_while_walking_stops_at_once_and_emits_nothing(lua, world):
    enqueue(world, WALK_EAST, WAIT_1)
    run(world, 1)
    answer_east(lua, world)
    run(world, 2)

    assert rpc(world, "jobs_cancel", {"all": True}, "c")["ok"] is True
    assert world.BODY.walking_state.walking is False
    run(world, 2)
    assert world.BODY.walking_state.walking is False
    assert events(world) == []
    assert states(world) == [(1, "cancelled", "cancelled"), (2, "cancelled", "cancelled")]
    assert world.LABEL.text == "Buddy · Standing by"


@pytest.mark.parametrize(
    ("op", "args", "message"),
    [
        ("jobs_enqueue", {"jobs": []}, "jobs: 1 to 8 jobs expected"),
        ("jobs_enqueue", {"jobs": [WAIT_1] * 9}, "jobs: 1 to 8 jobs expected"),
        (
            "jobs_enqueue",
            {"jobs": [{"kind": "dig", "args": {}}]},
            "jobs[0].kind: one of wait, walk_to expected",
        ),
        (
            "jobs_enqueue",
            {"jobs": [WAIT_1, {"kind": "walk_to", "args": {"pos": {"x": 1, "y": 2}, "radius": "far"}}]},
            "jobs[1].args.radius: number expected",
        ),
        (
            "jobs_enqueue",
            {"jobs": [{"kind": "walk_to", "args": {"radius": 1}}]},
            "jobs[0].args: pos or entity expected",
        ),
        (
            "jobs_enqueue",
            {"jobs": [{"kind": "walk_to", "args": {"pos": {"x": 1}, "radius": 1}}]},
            "jobs[0].args.pos: {x, y} expected",
        ),
        (
            "jobs_enqueue",
            {"jobs": [{"kind": "wait", "args": {"ticks": 0}}]},
            "jobs[0].args.ticks: positive number expected",
        ),
        (
            "jobs_enqueue",
            {"jobs": [{**WAIT_1, "timeout_ticks": "soon"}]},
            "jobs[0].timeout_ticks: number expected",
        ),
        ("jobs_cancel", {}, "id or all expected"),
        ("jobs_cancel", {"id": 5}, "id: no queued or running job 5"),
    ],
)
def test_a_bad_request_names_the_field_and_queues_nothing(world, op, args, message):
    assert rpc(world, op, args) == {"v": 1, "id": "t", "ok": False, "e": "bad_request", "m": message}
    assert states(world) == []


def test_the_17th_queued_job_is_refused_and_finished_jobs_make_room(world):
    assert enqueue(world, *[WAIT_1] * 8, id_="a")["r"] == {"ids": [1, 2, 3, 4, 5, 6, 7, 8]}
    assert enqueue(world, *[WAIT_1] * 8, id_="b")["r"] == {"ids": [9, 10, 11, 12, 13, 14, 15, 16]}
    assert enqueue(world, WAIT_1, id_="c") == {
        "v": 1,
        "id": "c",
        "ok": False,
        "e": "bad_request",
        "m": "jobs: the queue holds at most 16 jobs",
    }

    run(world, 16)
    assert enqueue(world, WAIT_1, id_="d")["r"] == {"ids": [17]}
    assert [job[0] for job in states(world)] == list(range(2, 18))


@pytest.mark.parametrize(
    ("op", "args", "other", "after"),
    [
        (
            "jobs_enqueue",
            {"jobs": [WAIT_1]},
            {"jobs": [WAIT_1, WAIT_1]},
            [(1, "queued", None), (2, "queued", None)],
        ),
        # a re-run would answer bad_request: job 1 is no longer queued
        ("jobs_cancel", {"id": 1}, {"all": True}, [(1, "cancelled", "cancelled")]),
    ],
)
def test_a_repeated_write_replays_its_reply_and_other_args_conflict(world, op, args, other, after):
    enqueue(world, {"kind": "wait", "args": {"ticks": 100}}, id_="first")
    first = rpc(world, op, args, "w1")
    assert first["ok"] is True
    assert rpc(world, op, args, "w1") == first
    assert states(world) == after

    assert rpc(world, op, other, "w1") == {
        "v": 1,
        "id": "w1",
        "ok": False,
        "e": "id_conflict",
        "m": "id already used with different arguments",
    }
