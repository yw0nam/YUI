-- A fake world for the job and walker units: one body on an open plane, a surface that records path requests.

storage = { map_id = "m" }
require("scripts.storage").ensure()

EVENTS, PRINTED, REQUESTS = {}, {}, {}
LABEL = nil
-- walking directions the fake plane refuses to move in, by defines.direction value
BLOCKED = {}

SURFACE = {
  request_path = function(spec)
    REQUESTS[#REQUESTS + 1] = spec
    spec.tick = DEPS.tick
    return #REQUESTS
  end,
}
BODY = {
  valid = true,
  name = "character",
  unit_number = 7,
  position = { x = 0, y = 0 },
  walking_state = { walking = false, direction = 0 },
  mining_state = { mining = false },
  crafting_queue_size = 0,
  surface = SURFACE,
  force = "player",
  prototype = { collision_box = "box", collision_mask = "mask" },
}
storage.body.entity = BODY
HOST = { name = "host" }

DEPS = {
  storage = storage,
  tick = 0,
  body_name = "Buddy",
  host = function() return HOST end,
  push = function(kind, data) EVENTS[#EVENTS + 1] = { kind = kind, data = data } end,
  draw_text = function(spec)
    LABEL = { valid = true, text = spec.text }
    return LABEL
  end,
  direction = { north = 0, northeast = 2, east = 4, southeast = 6, south = 8, southwest = 10, west = 12, northwest = 14 },
  from_json = JSON.decode,
  to_json = JSON.encode,
  print = function(text) PRINTED[#PRINTED + 1] = text end,
}

WALKER = require("scripts.walker")
JOBS = require("scripts.jobs")
RPC = require("scripts.rpc")
DEPS.ops = RPC.OPS

local VECTORS = {
  [0] = { 0, -1 }, [2] = { 1, -1 }, [4] = { 1, 0 }, [6] = { 1, 1 },
  [8] = { 0, 1 }, [10] = { -1, 1 }, [12] = { -1, 0 }, [14] = { -1, -1 },
}

local function move()
  local walking = BODY.walking_state
  if not (BODY.valid and walking.walking) or BLOCKED[walking.direction] then
    return
  end
  local v = VECTORS[walking.direction]
  local scale = 0.15 / math.sqrt(v[1] * v[1] + v[2] * v[2])
  BODY.position = { x = BODY.position.x + v[1] * scale, y = BODY.position.y + v[2] * scale }
end

--- Up to n game ticks: act(DEPS) runs, then the body walks 0.15 tiles; stops at act's first non-nil result.
function step(n, act)
  for _ = 1, n do
    DEPS.tick = DEPS.tick + 1
    local result = act(DEPS)
    move()
    if result ~= nil then
      return result, DEPS.tick
    end
  end
  return nil, DEPS.tick
end

--- Ticks until a new path request goes out; returns its tick.
function step_until_request(act)
  local before = #REQUESTS
  for _ = 1, 1000 do
    step(1, act)
    if #REQUESTS > before then
      return DEPS.tick
    end
  end
  error("no path request went out")
end

--- Answers the newest path request: a path through the given points, or none.
function answer(points, try_again_later)
  local path = nil
  if points then
    path = {}
    for i, p in ipairs(points) do
      path[i] = { position = { x = p[1], y = p[2] }, needs_destroy_to_reach = false }
    end
  end
  WALKER.on_path_finished(DEPS, { id = #REQUESTS, path = path, try_again_later = try_again_later or false, tick = DEPS.tick })
end
