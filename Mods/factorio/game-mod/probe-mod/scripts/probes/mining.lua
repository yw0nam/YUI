-- The mining probe: sets mining_state on the body against an iron-ore entity
-- and samples character_mining_progress and the inventory for 600 ticks.

local spawn = require("scripts.probes.spawn")

local DURATION_TICKS = 600
local SAMPLE_ITEM = "iron-ore"

local M = {}

local function inventory_count(body, item)
  local inventory = body.get_inventory(defines.inventory.character_main)
  return inventory and inventory.get_item_count(item) or 0
end

local function find_or_place_ore(surface, body)
  local pos = body.position
  local existing = surface.find_entities_filtered {
    name = SAMPLE_ITEM,
    area = { left_top = { x = pos.x - 8, y = pos.y - 8 }, right_bottom = { x = pos.x + 8, y = pos.y + 8 } },
  }
  if existing[1] and existing[1].valid then
    return existing[1]
  end
  local place = surface.find_non_colliding_position(SAMPLE_ITEM, { x = pos.x + 2, y = pos.y }, 8, 1)
    or { x = pos.x + 2, y = pos.y }
  return surface.create_entity { name = SAMPLE_ITEM, position = place, amount = 500 }
end

function M.start(storage)
  local body = spawn.make_body(storage)
  local ore = find_or_place_ore(body.surface, body)
  if not (ore and ore.valid) then
    return { state = "done", error = "could not place iron-ore next to the body" }
  end
  local pos = ore.position
  body.update_selected_entity(pos)
  body.mining_state = { mining = true, position = pos }
  return {
    state = "running",
    start_tick = game.tick,
    ore_position = { x = pos.x, y = pos.y },
    initial_count = inventory_count(body, SAMPLE_ITEM),
    series = {},
  }
end

function M.tick(storage)
  local state = storage.probe.mining
  local body = storage.probe.body
  if not (state and body and body.valid) then
    if state then
      state.state = "done"
    end
    return
  end
  local inventory = body.get_inventory(defines.inventory.character_main)
  state.series[#state.series + 1] = {
    tick = game.tick - state.start_tick,
    progress = body.character_mining_progress,
    count = inventory and inventory.get_item_count(SAMPLE_ITEM) or 0,
  }
  -- re-select in case the engine cleared the mining target
  if game.tick % 60 == 0 then
    body.update_selected_entity(state.ore_position)
    body.mining_state = { mining = true, position = state.ore_position }
  end
  if game.tick - state.start_tick >= DURATION_TICKS then
    state.state = "done"
  end
end

function M.result(storage)
  local state = storage.probe.mining
  local body = storage.probe.body
  local final_count = state.initial_count
  local selected = nil
  if body and body.valid then
    final_count = inventory_count(body, SAMPLE_ITEM)
    selected = body.selected and body.selected.name or nil
  end
  return {
    probe = "mining",
    state = state.state,
    selected = selected,
    initial_count = state.initial_count,
    final_count = final_count,
    mined = final_count - state.initial_count,
    series = state.series,
    error = state.error,
  }
end

return M
