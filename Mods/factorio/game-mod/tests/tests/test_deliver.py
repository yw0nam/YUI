import pytest
from conftest import events, rpc, run

DELIVER = {"kind": "deliver", "args": {"item": "coal", "count": 20}}

# the deliver world: the body holds coal, the surface spills it, the host stands 6 tiles east
SETUP = """
HOST.position = { x = 6, y = 0 }
HOST.surface = SURFACE
BODY.main = { coal = 20 }
function BODY.get_inventory(_index)
  return {
    get_item_count = function(name) return BODY.main[name] or 0 end,
    remove = function(spec)
      local held = BODY.main[spec.name] or 0
      local taken = math.min(held, spec.count)
      BODY.main[spec.name] = held - taken
      return taken
    end,
  }
end
function BODY.insert(spec)
  BODY.main[spec.name] = (BODY.main[spec.name] or 0) + spec.count
  return spec.count
end
SPILLED = {}
SPILL_COUNT = nil
SURFACE.spill_item_stack = function(spec)
  SPILLED[#SPILLED + 1] = spec
  local out = {}
  for _ = 1, SPILL_COUNT or spec.stack.count do
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


def answer_east(lua, world):
    world.answer(lua.table_from([lua.table_from([6, 0])]), False)


def walk_to_the_host(lua, world):
    enqueue(world, DELIVER)
    run(world, 1)
    answer_east(lua, world)
    run(world, 30)


def test_deliver_walks_to_the_host_spills_every_item_and_ends_done(lua, deliver_world):
    walk_to_the_host(lua, deliver_world)

    assert events(deliver_world) == [
        {"kind": "job_done", "data": {"id": 1, "kind": "deliver"}},
        {"kind": "queue_idle", "data": {"last_job_id": 1}},
    ]
    assert spilled(deliver_world) == [
        {
            "position": {"x": 6.0, "y": 0.0},
            "stack": {"name": "coal", "count": 20},
            "enable_looted": True,
            "allow_belts": False,
        }
    ]
    assert deliver_world.BODY.main.coal == 0
    assert abs(deliver_world.BODY.position.x - 6) <= 3
    assert deliver_world.BODY.walking_state.walking is False
    assert deliver_world.LABEL.text == "Buddy · Standing by"
    assert states(deliver_world) == [(1, "done", None)]


def test_the_status_line_holds_the_item_while_walking(lua, deliver_world):
    enqueue(deliver_world, DELIVER)
    run(deliver_world, 1)
    assert deliver_world.LABEL.text == "Buddy · Holding: coal 20"


def test_a_partial_spill_returns_the_rest_and_ends_target_full(lua, deliver_world):
    lua.execute("SPILL_COUNT = 12")
    walk_to_the_host(lua, deliver_world)

    assert events(deliver_world) == [
        {
            "kind": "job_failed",
            "data": {
                "id": 1,
                "kind": "deliver",
                "reason": "target_full",
                "removed": 20,
                "spilled": 12,
                "returned": 8,
            },
        }
    ]
    assert deliver_world.BODY.main.coal == 8
    assert records(deliver_world)[0]["progress"] == {"removed": 20, "spilled": 12, "returned": 8}
    assert deliver_world.LABEL.text == "Buddy · Standing by"
    assert states(deliver_world) == [(1, "failed", "target_full")]


def test_fewer_items_than_asked_fail_no_item_and_remove_nothing(lua, deliver_world):
    lua.execute("BODY.main = { coal = 3 }")
    walk_to_the_host(lua, deliver_world)

    assert events(deliver_world) == [
        {
            "kind": "job_failed",
            "data": {"id": 1, "kind": "deliver", "reason": "no_item", "item": "coal", "count": 20, "held": 3},
        }
    ]
    assert spilled(deliver_world) == []
    assert deliver_world.BODY.main.coal == 3
    assert records(deliver_world)[0]["progress"] == {"item": "coal", "count": 20, "held": 3}
    assert states(deliver_world) == [(1, "failed", "no_item")]


def test_the_default_timeout_is_3600(deliver_world):
    enqueue(deliver_world, DELIVER)
    assert records(deliver_world)[0]["timeout_ticks"] == 3600
