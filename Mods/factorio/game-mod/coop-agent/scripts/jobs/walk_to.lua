-- The walk_to job: walk to within radius of a position, or of an entity's position at the job's start.

local body = require("scripts.body")
local check = require("scripts.jobs.check")
local enemies = require("scripts.threat.enemies")
local unit_index = require("scripts.unit_index")
local walker = require("scripts.walker")

local TIMEOUT_TICKS = 3600

local M = {}

--- nil for valid args, else the field (nil for args itself) and what was expected.
function M.validate(args)
  if (args.pos == nil) == (args.entity == nil) then
    return nil, "pos or entity expected"
  end
  if args.pos ~= nil and not check.position(args.pos) then
    return "pos", "{x, y} expected"
  end
  if args.entity ~= nil and type(args.entity) ~= "number" then
    return "entity", "unit_number expected"
  end
  local expected = check.positive(args.radius)
  if expected then
    return "radius", expected
  end
  return nil
end

function M.default_timeout()
  return TIMEOUT_TICKS
end

--- The target's position and its status-line name; nil once an entity target is gone.
local function target(args)
  if args.entity then
    local entity = unit_index.get(args.entity)
    return entity and entity.position, entity and entity.name
  end
  return args.pos, string.format("%d,%d", math.floor(args.pos.x), math.floor(args.pos.y))
end

function M.start(deps, job)
  local pos, name = target(job.args)
  if not pos then
    return "target_gone"
  end
  if enemies.near(deps, body.entity(deps).surface, pos) then
    return "threat"
  end
  body.set_status(deps, "Walking to " .. name)
  walker.go(deps, pos, job.args.radius)
  return nil
end

function M.tick(deps, job)
  local pos = target(job.args)
  if not pos then
    return "target_gone"
  end
  job.progress = { distance = math.floor(walker.distance(body.entity(deps).position, pos) + 0.5) }
  local result = walker.tick(deps)
  return result == "arrived" and "done" or result
end

return M
