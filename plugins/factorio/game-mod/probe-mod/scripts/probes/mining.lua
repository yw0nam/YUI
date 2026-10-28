-- The mining probe: mining_state against iron ore, sampling mining progress and the inventory for 600 ticks.

local probe_body = require("scripts.body")

local DURATION_TICKS = 600
local SAMPLE_ITEM = "iron-ore"

local M = {}

local function find_or_place_ore(body)
  local pos = body.position
  local existing = body.surface.find_entities_filtered {
    name = SAMPLE_ITEM,
    area = { left_top = { x = pos.x - 8, y = pos.y - 8 }, right_bottom = { x = pos.x + 8, y = pos.y + 8 } },
  }
  if existing[1] and existing[1].valid then
    return existing[1]
  end
  return body.surface.create_entity { name = SAMPLE_ITEM, position = probe_body.spot(body, SAMPLE_ITEM, 2), amount = 500 }
end

function M.start(storage)
  local body = probe_body.make(storage)
  local ore = find_or_place_ore(body)
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
    initial_count = probe_body.inventory_count(body, SAMPLE_ITEM),
    series = {},
  }
end

function M.tick(storage)
  local state = storage.probe.mining
  local body = probe_body.get(state)
  if not body then
    return
  end
  state.series[#state.series + 1] = {
    tick = game.tick - state.start_tick,
    progress = body.character_mining_progress,
    count = probe_body.inventory_count(body, SAMPLE_ITEM),
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
  local body = probe_body.get(nil)
  local final_count = state.initial_count
  local selected = nil
  if body then
    final_count = probe_body.inventory_count(body, SAMPLE_ITEM)
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
