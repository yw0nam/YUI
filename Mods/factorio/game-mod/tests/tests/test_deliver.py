import pytest
from conftest import events, rpc, run

DELIVER = {"kind": "deliver", "args": {"item": "coal", "count": 20}}

# the deliver world: the body holds coal, the surface spills it, the host stands 6 tiles east
SETUP = """
HOST.position = { x = 6, y = 0 }
HOST.surface = SURFACE
BODY.main = { coal = 20 }
function BODY.get_item_count(name) return BODY.main[name] or 0 end
function BODY.get_main_inventory()
  return {
    remove = function(spec)
      local held = BODY.main[spec.name] or 0
      local taken = math.min(held, spec.count)
      BODY.main[spec.name] = held - taken
      return taken
    end,
  }
end
SPILLED = {}
SURFACE.spill_item_stack = function(spec)
  SPILLED[#SPILLED + 1] = spec
  local out = {}
  for _ = 1, spec.stack.count do
    out[#out + 1] = { name = "item-on-ground", to_be_looted = true, stack = { count = 1 } }
  end
  return out
end
"""


@pytest.fixture
def deliver_world(world, lua):
    lua.execute(SETUP)
    return world


def enqueue(world, *jobs, id_="t"):
    return rpc(world, "jobs_enqueue", {"jobs": list(jobs)}, id_)


def states(world):
    return [(job["id"], job["state"], job.get("reason")) for job in rpc(world, "jobs", {}, "read")["r"]]


def records(world):
    return rpc(world, "jobs", {}, "read")["r"]


def spilled(world):
    out = []
    for spec in world.SPILLED.values():
        out.append(
            {
                "position": {"x": spec.position.x, "y": spec.position.y},
                "stack": dict(spec.stack),
                "enable_looted": spec.enable_looted,
                "allow_belts": spec.allow_belts,
            }
        )
    return out


def answer(lua, world, x):
    world.answer(lua.table_from([lua.table_from([x, 0])]), False)


def walk_to_the_spill(lua, world):
    """Arrival, spill and the step-back request; the step-back path stays unanswered."""
    enqueue(world, DELIVER)
    run(world, 1)
    answer(lua, world, 6)
    run(world, 30)


def walk_to_the_host(lua, world):
    walk_to_the_spill(lua, world)
    answer(lua, world, 0)
    run(world, 20)


def test_deliver_spills_on_the_hosts_far_side_steps_back_and_ends_done(lua, deliver_world):
    walk_to_the_host(lua, deliver_world)

    assert events(deliver_world) == [
        {"kind": "job_done", "data": {"id": 1, "kind": "deliver"}},
        {"kind": "queue_idle", "data": {"last_job_id": 1}},
    ]
    assert spilled(deliver_world) == [
        {
            "position": {"x": 7.5, "y": 0.0},
            "stack": {"name": "coal", "count": 20},
            "enable_looted": True,
            "allow_belts": False,
        }
    ]
    assert dict(deliver_world.REQUESTS[2].goal) == {"x": 0.0, "y": 0.0}
    assert deliver_world.BODY.main.coal == 0
    assert 0.85 <= deliver_world.BODY.position.x <= 1.01
    assert deliver_world.BODY.walking_state.walking is False
    assert deliver_world.LABEL.text == "Buddy · Standing by"
    assert states(deliver_world) == [(1, "done", None)]


def test_the_status_line_holds_the_item_while_walking(lua, deliver_world):
    enqueue(deliver_world, DELIVER)
    run(deliver_world, 1)
    assert deliver_world.LABEL.text == "Buddy · Holding: coal 20"


def test_done_waits_for_the_step_backs_180_ticks(lua, deliver_world):
    walk_to_the_spill(lua, deliver_world)
    answer(lua, deliver_world, 0)
    lua.execute("BLOCKED[12] = true")  # west: the step back cannot move

    run(deliver_world, 160)
    assert events(deliver_world) == []
    run(deliver_world, 30)
    assert events(deliver_world) == [
        {"kind": "job_done", "data": {"id": 1, "kind": "deliver"}},
        {"kind": "queue_idle", "data": {"last_job_id": 1}},
    ]
    assert states(deliver_world) == [(1, "done", None)]


def test_a_host_moved_past_three_tiles_re_aims_before_spilling(lua, deliver_world):
    enqueue(deliver_world, DELIVER)
    run(deliver_world, 1)
    answer(lua, deliver_world, 6)
    lua.execute("HOST.position = { x = 20, y = 0 }")
    run(deliver_world, 25)
    answer(lua, deliver_world, 20)
    run(deliver_world, 120)
    answer(lua, deliver_world, 14)
    run(deliver_world, 20)

    assert events(deliver_world) == [
        {"kind": "job_done", "data": {"id": 1, "kind": "deliver"}},
        {"kind": "queue_idle", "data": {"last_job_id": 1}},
    ]
    assert dict(deliver_world.REQUESTS[2].goal) == {"x": 20.0, "y": 0.0}
    assert spilled(deliver_world)[0]["position"] == {"x": 21.5, "y": 0.0}
    assert 14.05 <= deliver_world.BODY.position.x <= 15.01


def test_fewer_items_at_the_start_fail_no_item_before_any_walk(lua, deliver_world):
    lua.execute("BODY.main = { coal = 3 }")
    enqueue(deliver_world, DELIVER)
    run(deliver_world, 1)

    assert events(deliver_world) == [
        {
            "kind": "job_failed",
            "data": {"id": 1, "kind": "deliver", "reason": "no_item", "item": "coal", "count": 20, "held": 3},
        }
    ]
    assert len(deliver_world.REQUESTS) == 0
    assert spilled(deliver_world) == []
    assert deliver_world.BODY.main.coal == 3
    assert deliver_world.LABEL.text == "Buddy · Standing by"
    assert states(deliver_world) == [(1, "failed", "no_item")]


def test_fewer_items_at_the_spill_fail_no_item_and_remove_nothing(lua, deliver_world):
    enqueue(deliver_world, DELIVER)
    run(deliver_world, 1)
    answer(lua, deliver_world, 6)
    lua.execute("BODY.main = { coal = 3 }")
    run(deliver_world, 30)

    assert events(deliver_world) == [
        {
            "kind": "job_failed",
            "data": {"id": 1, "kind": "deliver", "reason": "no_item", "item": "coal", "count": 20, "held": 3},
        }
    ]
    assert spilled(deliver_world) == []
    assert deliver_world.BODY.main.coal == 3
    assert states(deliver_world) == [(1, "failed", "no_item")]


def test_the_default_timeout_is_3600(deliver_world):
    enqueue(deliver_world, DELIVER)
    assert records(deliver_world)[0]["timeout_ticks"] == 3600
