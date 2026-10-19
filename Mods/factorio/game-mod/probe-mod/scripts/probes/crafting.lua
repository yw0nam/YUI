-- The crafting probe: one iron-gear-wheel by hand, sampling the crafting queue for 600 ticks.

local spawn = require("scripts.probes.spawn")

local DURATION_TICKS = 600
local RECIPE = "iron-gear-wheel"
local INGREDIENT_ITEM = "iron-plate"
local PRODUCT_ITEM = "iron-gear-wheel"

local M = {}

function M.start(storage)
  local body = spawn.make_body(storage)
  local inventory = body.get_inventory(defines.inventory.character_main)
  inventory.insert { name = INGREDIENT_ITEM, count = 10 }
  local queued = body.begin_crafting { count = 1, recipe = RECIPE }
  return {
    state = "running",
    start_tick = game.tick,
    queued = queued,
    initial_count = spawn.inventory_count(body, PRODUCT_ITEM),
    series = {},
  }
end

function M.tick(storage)
  local state = storage.probe.crafting
  local body = spawn.body(state)
  if not body then
    return
  end
  local gear = spawn.inventory_count(body, PRODUCT_ITEM)
  if gear > state.initial_count and not state.ticks_to_craft then
    state.ticks_to_craft = game.tick - state.start_tick
  end
  state.series[#state.series + 1] = {
    tick = game.tick - state.start_tick,
    progress = body.crafting_queue_progress,
    count = gear,
  }
  if gear > state.initial_count or game.tick - state.start_tick >= DURATION_TICKS then
    state.state = "done"
  end
end

function M.result(storage)
  local state = storage.probe.crafting
  local body = spawn.body(nil)
  local crafted = state.initial_count
  if body then
    crafted = spawn.inventory_count(body, PRODUCT_ITEM)
  end
  return {
    probe = "crafting",
    state = state.state,
    queued = state.queued,
    crafted = crafted - state.initial_count,
    ticks_to_craft = state.ticks_to_craft,
    series = state.series,
  }
end

return M
