-- The deliver job: walk to the host and spill the held items there, flagged for the host to loot.

local body = require("scripts.body")
local walker = require("scripts.walker")

local TIMEOUT_TICKS = 3600
local HOST_RADIUS = 3
local MAX_COUNT = 1000

local M = {}

local function main_inventory(entity)
  return entity.get_inventory(defines.inventory.character_main)
end

--- nil for valid args, else the field and what was expected.
function M.validate(args)
  if type(args.item) ~= "string" then
    return "item", "string expected"
  end
  local count = args.count
  if type(count) ~= "number" then
    return "count", "number expected"
  end
  if count % 1 ~= 0 then
    return "count", "integer expected"
  end
  if count < 1 or count > MAX_COUNT then
    return "count", "1 to " .. MAX_COUNT .. " expected"
  end
  return nil
end

function M.default_timeout()
  return TIMEOUT_TICKS
end

function M.start(deps, job)
  local held = main_inventory(body.entity(deps)).get_item_count(job.args.item)
  body.set_status(deps, "Holding: " .. job.args.item .. " " .. held)
  walker.go(deps, deps.host().position, HOST_RADIUS)
  return nil
end

--- The removal, spill and return at the host: "done", or a failure reason with its detail.
local function unload(deps, job)
  local entity = body.entity(deps)
  local item, count = job.args.item, job.args.count
  local inventory = main_inventory(entity)
  local held = inventory.get_item_count(item)
  if held < count then
    local detail = { item = item, count = count, held = held }
    job.progress = detail
    return "no_item", detail
  end
  local removed = inventory.remove { name = item, count = count }
  local spilled = 0
  for _, ground in ipairs(entity.surface.spill_item_stack {
    position = deps.host().position,
    stack = { name = item, count = removed },
    enable_looted = true,
    allow_belts = false,
  }) do
    spilled = spilled + ground.stack.count
  end
  if spilled == removed then
    return "done"
  end
  local returned = entity.insert { name = item, count = removed - spilled }
  local detail = { removed = removed, spilled = spilled, returned = returned }
  job.progress = detail
  return "target_full", detail
end

function M.tick(deps, job)
  local result = walker.tick(deps)
  if result == "arrived" then
    return unload(deps, job)
  end
  return result
end

return M
