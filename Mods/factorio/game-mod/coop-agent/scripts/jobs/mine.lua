-- The mine job: mine the nearest allowed entity that yields an item until the body holds count more of it.

local body = require("scripts.body")
local check = require("scripts.jobs.check")
local enemies = require("scripts.threat.enemies")
local holding = require("scripts.jobs.holding")
local unit_index = require("scripts.unit_index")
local walker = require("scripts.walker")

local SEARCH_RADIUS = 64
local CHECK_TICKS = 30
local STALL_FACTOR = 2
local TIMEOUT_FACTOR = 3
local WALK_ALLOWANCE_TICKS = 3600
local MAX_TIMEOUT_TICKS = 36000

local M = {}

--- nil for valid args, else the field and what was expected.
function M.validate(args)
  if type(args.name) ~= "string" then
    return "name", "string expected"
  end
  local expected = check.count(args.count)
  if expected then
    return "count", expected
  end
  if args.entity ~= nil and type(args.entity) ~= "number" then
    return "entity", "unit_number expected"
  end
  return nil
end

local function yields(prototype, name)
  local mineable = prototype.mineable_properties
  for _, product in ipairs(mineable.minable and mineable.products or {}) do
    if product.type == "item" and product.name == name then
      return true
    end
  end
  return false
end

-- resources, trees, rocks, and whatever is marked for deconstruction
local function allowed(entity)
  local kind = entity.type
  return kind == "resource"
    or kind == "tree"
    or kind == "simple-entity" and entity.prototype.count_as_rock_for_filtered_deconstruction
    or entity.to_be_deconstructed()
end

-- a resource such as uranium ore that only a drill fed with a fluid mines
local function needs_fluid(entity)
  return entity.prototype.mineable_properties.required_fluid ~= nil
end

local function sources(deps, name)
  local names = {}
  for proto_name, prototype in pairs(deps.entity_prototypes) do
    if yields(prototype, name) then
      names[#names + 1] = proto_name
    end
  end
  return names
end

local function nearest(entity, names)
  if #names == 0 then
    return nil
  end
  local pos = entity.position
  local best, best_distance = nil, nil
  local found = entity.surface.find_entities_filtered { position = pos, radius = SEARCH_RADIUS, name = names }
  for _, candidate in ipairs(found) do
    local distance = walker.distance(pos, candidate.position)
    if (not best_distance or distance < best_distance) and allowed(candidate) and not needs_fluid(candidate) then
      best, best_distance = candidate, distance
    end
  end
  return best
end

local function mining_ticks(deps, entity, target)
  local modifier = 1 + entity.character_mining_speed_modifier + deps.force.manual_mining_speed_modifier
  local speed = entity.prototype.mining_speed * modifier
  return math.floor(target.prototype.mineable_properties.mining_time / speed * 60 + 0.5)
end

local function status(job)
  return string.format("Mining %s %d/%d", job.args.name, job.progress.gained, job.args.count)
end

local function choose(deps, job, state, target)
  local entity = body.entity(deps)
  state.target, state.cycle_ticks = target, mining_ticks(deps, entity, target)
  state.target_gained, state.next_cycle_tick = job.progress.gained, nil
  walker.go(deps, target.position, entity.resource_reach_distance)
end

-- Selecting the target itself, never another entity at its position, before mining it.
local function aim(entity, target)
  entity.selected = target
  if entity.selected == target then
    entity.mining_state = { mining = true, position = target.position }
  end
end

function M.start(deps, job)
  local entity = body.entity(deps)
  local args = job.args
  local names = sources(deps, args.name)
  local target
  if args.entity then
    target = unit_index.get(args.entity)
    if not target then
      return "target_gone"
    end
    if walker.distance(entity.position, target.position) > SEARCH_RADIUS then
      return "unreachable"
    end
    if needs_fluid(target) then
      return "unsupported"
    end
    if not (allowed(target) and yields(target.prototype, args.name)) then
      return "not_permitted"
    end
  else
    target = nearest(entity, names)
    if not target then
      return "target_gone"
    end
  end
  if enemies.near(deps, entity.surface, target.position) then
    return "threat"
  end
  local state = {
    names = names,
    before = entity.get_item_count(args.name),
    replaced_once = false,
    next_check = deps.tick,
  }
  deps.storage.jobs.kind_state = state
  job.progress = { gained = 0, count = args.count, path = "native" }
  choose(deps, job, state, target)
  local timeout = WALK_ALLOWANCE_TICKS + args.count * state.cycle_ticks * TIMEOUT_FACTOR
  job.timeout_ticks = job.timeout_ticks or math.min(timeout, MAX_TIMEOUT_TICKS)
  body.set_status(deps, status(job))
  return nil
end

-- A lost target: used up when it yielded since chosen, else removed by another actor, which is allowed once.
local function replace(deps, job, state, entity)
  if job.progress.gained == state.target_gained then
    if state.replaced_once then
      return "target_gone"
    end
    state.replaced_once = true
  end
  local target = nearest(entity, state.names)
  if not target then
    return "target_gone"
  end
  choose(deps, job, state, target)
  return nil
end

-- Every 30 ticks: count the gain, then the ends, then native progress against twice the mining time.
local function check(deps, job, state)
  local entity = body.entity(deps)
  local progress = job.progress
  local gained = entity.get_item_count(job.args.name) - state.before
  if gained ~= progress.gained then
    progress.gained, state.still_since = gained, deps.tick
    body.set_status(deps, status(job))
  end
  if gained >= job.args.count then
    return "done"
  end
  if not entity.can_insert(job.args.name) then
    return "target_full"
  end
  if not state.target.valid then
    return replace(deps, job, state, entity)
  end
  if walker.walking(deps) then
    return nil
  end
  if progress.path == "timed" then
    state.next_cycle_tick = state.next_cycle_tick or deps.tick + state.cycle_ticks
    return nil
  end
  if entity.character_mining_progress ~= state.mining_progress then
    state.mining_progress, state.still_since = entity.character_mining_progress, deps.tick
  end
  if deps.tick - state.still_since >= STALL_FACTOR * state.cycle_ticks then
    progress.path = "timed"
    entity.mining_state = { mining = false }
    state.next_cycle_tick = deps.tick + state.cycle_ticks
  else
    aim(entity, state.target)
  end
  return nil
end

function M.tick(deps, job)
  local state = deps.storage.jobs.kind_state
  if walker.walking(deps) then
    local result = walker.tick(deps)
    if result == "arrived" then
      state.still_since, state.next_check = deps.tick, deps.tick
    elseif result then
      return result
    end
  elseif state.next_cycle_tick and deps.tick >= state.next_cycle_tick then
    if state.target.valid then
      body.entity(deps).mine_entity(state.target)
    end
    state.next_cycle_tick = deps.tick + state.cycle_ticks
  end
  if deps.tick < state.next_check then
    return nil
  end
  state.next_check = deps.tick + CHECK_TICKS
  return check(deps, job, state)
end

--- The status line after the job is done.
function M.done_status(deps, job)
  return holding.status(deps, job.args.name)
end

return M
