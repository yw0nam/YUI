-- The baseline probe: hand-mining ticks per item for the four ores, a tree
-- and a rock, using the mining probe's method (mining_state + a selected
-- target), one target at a time.

local spawn = require("scripts.probes.spawn")

local MAX_TICKS_PER_TARGET = 1800

local TARGETS = {
  { resource = "iron-ore", item = "iron-ore", amount = 100 },
  { resource = "copper-ore", item = "copper-ore", amount = 100 },
  { resource = "coal", item = "coal", amount = 100 },
  { resource = "stone", item = "stone", amount = 100 },
  { resource = "tree-01", item = "wood" },
  { resource = "huge-rock", item = "stone" },
}

local M = {}

local function inventory_count(body, item)
  local inventory = body.get_inventory(defines.inventory.character_main)
  return inventory and inventory.get_item_count(item) or 0
end

local function place_target(storage, target)
  local body = storage.probe.body
  local pos = body.position
  local place = body.surface.find_non_colliding_position(target.resource, { x = pos.x + 2, y = pos.y }, 8, 1)
    or { x = pos.x + 2, y = pos.y }
  local entity
  if target.amount then
    entity = body.surface.create_entity { name = target.resource, position = place, amount = target.amount }
  else
    entity = body.surface.create_entity { name = target.resource, position = place }
  end
  return entity
end

local function begin_target(storage, state)
  local target = TARGETS[state.index]
  local entity = place_target(storage, target)
  if not (entity and entity.valid) then
    state.results[#state.results + 1] = { resource = target.resource, item = target.item, error = "placement failed" }
    state.index = state.index + 1
    return
  end
  local body = storage.probe.body
  local pos = entity.position
  body.update_selected_entity(pos)
  body.mining_state = { mining = true, position = pos }
  state.target = {
    resource = target.resource,
    item = target.item,
    position = { x = pos.x, y = pos.y },
    start_tick = game.tick,
    count_at_start = inventory_count(body, target.item),
  }
end

local function finish_target(storage, state, record)
  local entity = storage.probe.body.surface.find_entity(
    state.target.resource,
    { x = state.target.position.x, y = state.target.position.y }
  )
  if entity then
    entity.destroy()
  end
  record.resource = state.target.resource
  record.item = state.target.item
  state.results[#state.results + 1] = record
  state.target = nil
  state.index = state.index + 1
end

function M.start(storage)
  spawn.make_body(storage)
  return { state = "running", index = 1, results = {}, target = nil }
end

function M.tick(storage)
  local state = storage.probe.baseline
  local body = storage.probe.body
  if not (state and body and body.valid) then
    if state then
      state.state = "done"
    end
    return
  end
  if not state.target then
    if state.index > #TARGETS then
      state.state = "done"
      return
    end
    begin_target(storage, state)
    if not state.target then
      return -- placement failed; the next tick moves on
    end
  end

  local count = inventory_count(body, state.target.item)
  if count > state.target.count_at_start then
    finish_target(storage, state, { ticks = game.tick - state.target.start_tick })
  elseif game.tick - state.target.start_tick >= MAX_TICKS_PER_TARGET then
    finish_target(storage, state, { ticks = nil, timeout = true })
  end
end

function M.result(storage)
  local state = storage.probe.baseline
  return { probe = "baseline", state = state.state, results = state.results }
end

return M
