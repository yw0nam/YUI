-- A fake world for the job, walker, mine and threat units: one body on a surface that holds mineable entities and
-- enemies and records path requests.

-- the status op reads these game globals
script = { active_mods = { ["coop-agent"] = "test" } }
defines = { inventory = { character_main = 1 } }
remote = { interfaces = {} }
game = { connected_players = {} }

storage = { map_id = "m" }
require("scripts.storage").ensure()

EVENTS, PRINTED, REQUESTS = {}, {}, {}
LABEL = nil
-- walking directions the fake plane refuses to move in, by defines.direction value
BLOCKED = {}

-- mineable entities on the plane, the body's item counts, and the ticks mine_entity ran
ENTITIES, INVENTORY, MINED = {}, {}, {}
-- FULL: the body takes no item; NATIVE = false: mining_state makes no progress
FULL, NATIVE = false, true
-- military units on the plane
ENEMIES = {}

local function mineable(mining_time, products)
  return { minable = true, mining_time = mining_time, products = products }
end

local function item(name, amount)
  return { type = "item", name = name, amount = amount }
end

PROTOTYPES = {
  coal = { type = "resource", mineable_properties = mineable(1, { item("coal", 1) }) },
  ["tree-01"] = { type = "tree", mineable_properties = mineable(0.55, { item("wood", 4) }) },
  ["huge-rock"] = {
    type = "simple-entity",
    count_as_rock_for_filtered_deconstruction = true,
    mineable_properties = mineable(3, { item("stone", 24), item("coal", 24) }),
  },
  ["stone-furnace"] = { type = "furnace", mineable_properties = mineable(0.2, { item("stone-furnace", 1) }) },
  ["uranium-ore"] = { type = "resource", mineable_properties = mineable(2, { item("uranium-ore", 1) }) },
}
PROTOTYPES["uranium-ore"].mineable_properties.required_fluid = "sulfuric-acid"

--- A mineable entity at (x, y); a furnace gets a unit number, marked sets its deconstruction mark.
function place(name, x, y, marked)
  local proto = PROTOTYPES[name]
  local entity = { valid = true, name = name, type = proto.type, prototype = proto, position = { x = x, y = y } }
  entity.unit_number = proto.type == "furnace" and 100 + #ENTITIES or nil
  entity.to_be_deconstructed = function() return marked == true end
  ENTITIES[#ENTITIES + 1] = entity
  return entity
end

--- A military unit of force (default "enemy") at (x, y).
function enemy(x, y, force)
  local unit = { valid = true, position = { x = x, y = y }, force = force or "enemy" }
  ENEMIES[#ENEMIES + 1] = unit
  return unit
end

local function within(pos, radius)
  local out = {}
  for _, unit in ipairs(ENEMIES) do
    local dx, dy = unit.position.x - pos.x, unit.position.y - pos.y
    if unit.valid and dx * dx + dy * dy <= radius * radius then
      out[#out + 1] = unit
    end
  end
  return out
end

-- a resource never runs out; anything else is gone once mined
local function give(entity)
  for _, product in ipairs(entity.prototype.mineable_properties.products) do
    INVENTORY[product.name] = (INVENTORY[product.name] or 0) + product.amount
  end
  if entity.type ~= "resource" then
    entity.valid = false
  end
end

SURFACE = {
  request_path = function(spec)
    REQUESTS[#REQUESTS + 1] = spec
    spec.tick = DEPS.tick
    return #REQUESTS
  end,
  find_nearest_enemy = function(spec)
    local best, best_d2 = nil, nil
    for _, unit in ipairs(within(spec.position, spec.max_distance)) do
      local dx, dy = unit.position.x - spec.position.x, unit.position.y - spec.position.y
      if DEPS.force.is_enemy(unit.force) and (not best_d2 or dx * dx + dy * dy < best_d2) then
        best, best_d2 = unit, dx * dx + dy * dy
      end
    end
    return best
  end,
  find_entities_filtered = function(filter)
    if filter.is_military_target then
      local forces, out = {}, {}
      for _, force in ipairs(filter.force) do
        forces[force] = true
      end
      for _, unit in ipairs(within(filter.position, filter.radius)) do
        if forces[unit.force] then
          out[#out + 1] = unit
        end
      end
      return out
    end
    local names, out = {}, {}
    for _, name in ipairs(filter.name) do
      names[name] = true
    end
    for _, entity in ipairs(ENTITIES) do
      local dx, dy = entity.position.x - filter.position.x, entity.position.y - filter.position.y
      if entity.valid and names[entity.name] and dx * dx + dy * dy <= filter.radius * filter.radius then
        out[#out + 1] = entity
      end
    end
    return out
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
  prototype = { collision_box = "box", collision_mask = "mask", mining_speed = 0.5 },
  resource_reach_distance = 2.7,
  character_mining_speed_modifier = 0,
  character_mining_progress = 0,
  health = 250,
  get_item_count = function(name) return INVENTORY[name] or 0 end,
  can_insert = function() return not FULL end,
  mine_entity = function(entity)
    MINED[#MINED + 1] = DEPS.tick
    if FULL then
      return false
    end
    give(entity)
    return true
  end,
}
function BODY.get_inventory(_index)
  return { get_contents = function() return {} end }
end
storage.body.entity = BODY
HOST = { name = "host" }
HOST.position = { x = 0, y = 0 }
HOST.surface = SURFACE

DEPS = {
  storage = storage,
  tick = 0,
  body_name = "Buddy",
  start_mode = "follow",
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
  entity_prototypes = PROTOTYPES,
  item_prototypes = { coal = {} },
  force = { manual_mining_speed_modifier = 0, is_enemy = function(force) return force == "enemy" end },
  safe_radius = 48,
  forces = { "player", "enemy", "neutral" },
}

WALKER = require("scripts.walker")
IDLE = require("scripts.idle")
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

-- native mining: the selected entity yields once mining_time / 0.5 seconds of mining have passed
local spent = 0
local function mine()
  local target = BODY.selected
  if not (NATIVE and not FULL and BODY.valid and BODY.mining_state.mining and target and target.valid) then
    return
  end
  local ticks = target.prototype.mineable_properties.mining_time / 0.5 * 60
  spent = spent + 1
  if spent >= ticks then
    spent = 0
    give(target)
  end
  BODY.character_mining_progress = spent / ticks
end

--- Up to n game ticks: act(DEPS) runs, then the body walks 0.15 tiles and mines; stops at act's first non-nil result.
function step(n, act)
  for _ = 1, n do
    DEPS.tick = DEPS.tick + 1
    local result = act(DEPS)
    move()
    mine()
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
