-- The one path walker: a pathfinder route walked by walking_state; deps.on_path(path), deps.on_segment(from, to) may return a reject reason.

local body = require("scripts.body")

local PATH_RADIUS = 2
local RETRY_TICKS = 30
local MAX_FAILURES = 6
local AIM_TICKS = 5
local WAYPOINT_TILES = 0.5
local STALL_TICKS = 150
local STUCK_TICKS = 600
local STEP_TILES = 2
local STEP_BACK_TICKS = 60
local MOVED_TILES = 0.01
-- tan(22.5°): beyond it a component counts, splitting the circle into the 8 walking directions
local SLOPE = 0.4142

local DIRECTIONS = {
  [-1] = { [-1] = "northwest", [0] = "north", [1] = "northeast" },
  [0] = { [-1] = "west", [1] = "east" },
  [1] = { [-1] = "southwest", [0] = "south", [1] = "southeast" },
}

local M = {}

local function point(p)
  return { x = p.x, y = p.y }
end

function M.distance(a, b)
  local dx, dy = a.x - b.x, a.y - b.y
  return math.sqrt(dx * dx + dy * dy)
end

local function component(d, other)
  local bound = SLOPE * math.abs(other)
  return d > bound and 1 or d < -bound and -1 or 0
end

local function heading_to(from, to)
  local dx, dy = to.x - from.x, to.y - from.y
  return { x = component(dx, dy), y = component(dy, dx) }
end

local function walk(deps, entity, heading)
  entity.walking_state = { walking = true, direction = deps.direction[DIRECTIONS[heading.y][heading.x]] }
end

local function behind(pos, heading)
  local scale = STEP_TILES / math.sqrt(heading.x * heading.x + heading.y * heading.y)
  return { x = pos.x - heading.x * scale, y = pos.y - heading.y * scale }
end

local function request(walker, entity, start)
  local modifier = walker.failures >= 4 and 2 or walker.failures >= 2 and 1 or 0
  walker.path = nil
  walker.request_id = entity.surface.request_path {
    bounding_box = entity.prototype.collision_box,
    collision_mask = entity.prototype.collision_mask,
    start = start,
    goal = walker.target,
    force = entity.force,
    radius = PATH_RADIUS,
    can_open_gates = true,
    entity_to_ignore = entity,
    pathfind_flags = { cache = false },
    path_resolution_modifier = modifier,
  }
end

--- Starts a walk to within radius of target, replacing any walk under way.
function M.go(deps, target, radius)
  deps.storage.walker = {
    target = point(target),
    radius = radius,
    failures = 0,
    retry_tick = deps.tick,
    still_ticks = 0,
  }
end

--- Drops the walk and stops the body walking.
function M.cancel(deps)
  deps.storage.walker = nil
  body.stop_walking(deps)
end

local function finish(deps, result)
  M.cancel(deps)
  return result
end

--- The pathfinder's answer; a result for any other request id is stale and dropped.
function M.on_path_finished(deps, e)
  local walker = deps.storage.walker
  if not (walker and e.id == walker.request_id) then
    return
  end
  walker.request_id = nil
  if e.path then
    walker.fail_reason = deps.on_path and deps.on_path(e.path)
    local path = {}
    for i, waypoint in ipairs(e.path) do
      path[i] = point(waypoint.position)
    end
    walker.path, walker.index, walker.segment = path, 1, nil
    return
  end
  walker.failures = walker.failures + 1
  if walker.failures >= MAX_FAILURES then
    walker.fail_reason = "no_path"
  else
    walker.retry_tick = deps.tick + RETRY_TICKS
  end
end

-- Counts still ticks on a path (heading set on its first tick); true when a re-path (150) or a step back (600) takes the tick.
local function unstick(deps, walker, entity, pos)
  local moved = not walker.last or M.distance(pos, walker.last) >= MOVED_TILES
  walker.still_ticks = moved and 0 or walker.still_ticks + 1
  walker.last = point(pos)
  if walker.still_ticks >= STUCK_TICKS then
    walker.back = { from = walker.last, until_tick = deps.tick + STEP_BACK_TICKS }
    walk(deps, entity, { x = -walker.heading.x, y = -walker.heading.y })
    return true
  end
  if walker.still_ticks == STALL_TICKS then
    request(walker, entity, behind(pos, walker.heading))
    body.stop_walking(deps)
    return true
  end
  return false
end

--- One tick of the walk: nil while under way, "arrived" within radius of the target, else a failure reason.
function M.tick(deps)
  local walker = deps.storage.walker
  local entity = body.entity(deps)
  if not (walker and entity) then
    return nil
  end
  local pos = entity.position
  if walker.fail_reason then
    return finish(deps, walker.fail_reason)
  end
  if M.distance(pos, walker.target) <= walker.radius then
    return finish(deps, "arrived")
  end
  if walker.back then
    if M.distance(pos, walker.back.from) >= STEP_TILES or deps.tick >= walker.back.until_tick then
      return finish(deps, "stuck")
    end
    return nil
  end
  if not walker.path then
    if not walker.request_id and deps.tick >= walker.retry_tick then
      request(walker, entity, point(pos))
    end
    return nil
  end
  if unstick(deps, walker, entity, pos) then
    return nil
  end
  while walker.path[walker.index] and M.distance(pos, walker.path[walker.index]) <= WAYPOINT_TILES do
    walker.index = walker.index + 1
  end
  local goal = walker.path[walker.index] or walker.target
  if walker.segment ~= walker.index then
    walker.segment = walker.index
    local rejected = deps.on_segment and deps.on_segment(pos, goal)
    if rejected then
      return finish(deps, rejected)
    end
    walker.aim_tick = nil
  end
  if not walker.aim_tick or deps.tick - walker.aim_tick >= AIM_TICKS then
    walker.aim_tick = deps.tick
    walker.heading = heading_to(pos, goal)
    walk(deps, entity, walker.heading)
  end
  return nil
end

function M.on_path_finished_event(e)
  M.on_path_finished(body.game_deps(), e)
end

return M
