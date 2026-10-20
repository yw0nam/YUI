-- The deliver job: walk to the host, spill the held items on its far side, and step back from the pile.

local body = require("scripts.body")
local check = require("scripts.jobs.check")
local holding = require("scripts.jobs.holding")
local walker = require("scripts.walker")

local TIMEOUT_TICKS = 3600
local HOST_RADIUS = 3
local SPILL_TILES = 1.5
local STEP_BACK_TILES = 6
local STEP_BACK_RADIUS = 1
local STEP_BACK_TICKS = 180

local M = {}

--- nil for valid args, else the field and what was expected.
function M.validate(args, deps)
  if type(args.item) ~= "string" then
    return "item", "string expected"
  end
  if not deps.item_prototypes[args.item] then
    return "item", "a known item name expected"
  end
  local expected = check.count(args.count)
  if expected then
    return "count", expected
  end
  return nil
end

function M.default_timeout()
  return TIMEOUT_TICKS
end

--- The unit vector from b to a.
local function unit(a, b)
  local dx, dy = a.x - b.x, a.y - b.y
  local d = math.sqrt(dx * dx + dy * dy)
  return { x = dx / d, y = dy / d }
end

local function offset(from, dir, tiles)
  return { x = from.x + dir.x * tiles, y = from.y + dir.y * tiles }
end

--- A copy of the position, so a later host move does not move the captured walk target.
local function point(p)
  return { x = p.x, y = p.y }
end

function M.start(deps, job)
  local entity = body.entity(deps)
  local held = entity.get_item_count(job.args.item)
  if held < job.args.count then
    return "no_item", { item = job.args.item, count = job.args.count, held = held }
  end
  local host = deps.host()
  deps.storage.jobs.kind_state = { target = point(host.position) }
  body.set_status(deps, holding.status(deps, job.args.item))
  walker.go(deps, host.position, HOST_RADIUS)
  return nil
end

--- The removal and spill on the host's far side: nil once spilled, else a failure reason with its detail.
local function unload(deps, job, host)
  local entity = body.entity(deps)
  local item, count = job.args.item, job.args.count
  local held = entity.get_item_count(item)
  if held < count then
    return "no_item", { item = item, count = count, held = held }
  end
  local removed = entity.get_main_inventory().remove { name = item, count = count }
  local spilled = 0
  for _, ground in ipairs(host.surface.spill_item_stack {
    position = offset(host.position, unit(host.position, entity.position), SPILL_TILES),
    stack = { name = item, count = removed },
    enable_looted = true,
    allow_belts = false,
  }) do
    spilled = spilled + ground.stack.count
  end
  if spilled ~= removed then
    return "target_full", { removed = removed, spilled = spilled }
  end
  return nil
end

function M.tick(deps, job)
  local state = deps.storage.jobs.kind_state
  local result = walker.tick(deps)
  if result == nil then
    if state.step and deps.tick >= state.step.until_tick then
      return "done"
    end
    return nil
  end
  -- the step back ending, arrived or not, ends the delivered job
  if state.step then
    return "done"
  end
  if result ~= "arrived" then
    return result
  end
  local host = deps.host()
  if walker.distance(host.position, state.target) > HOST_RADIUS then
    state.target = point(host.position)
    walker.go(deps, host.position, HOST_RADIUS)
    return nil
  end
  local reason, detail = unload(deps, job, host)
  if reason then
    return reason, detail
  end
  state.step = {
    target = offset(host.position, unit(body.entity(deps).position, host.position), STEP_BACK_TILES),
    until_tick = deps.tick + STEP_BACK_TICKS,
  }
  walker.go(deps, state.step.target, STEP_BACK_RADIUS)
  return nil
end

return M
