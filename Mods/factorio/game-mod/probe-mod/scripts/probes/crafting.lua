-- The crafting probe: one iron-gear-wheel by hand, sampling the crafting
-- queue for 600 ticks.

local spawn = require("scripts.probes.spawn")

local DURATION_TICKS = 600
local RECIPE = "iron-gear-wheel"
local INGREDIENT_ITEM = "iron-plate"
local PRODUCT_ITEM = "iron-gear-wheel"

local M = {}

local function inventory(body)
  return body.get_inventory(defines.inventory.character_main)
end

function M.start(storage)
  local body = spawn.make_body(storage)
  local inventory = inventory(body)
  inventory.insert { name = INGREDIENT_ITEM, count = 10 }
  local queued = body.begin_crafting { count = 1, recipe = RECIPE }
  return {
    state = "running",
    start_tick = game.tick,
    queued = queued,
    initial_count = inventory.get_item_count(PRODUCT_ITEM),
    series = {},
  }
end

function M.tick(storage)
  local state = storage.probe.crafting
  local body = storage.probe.body
  if not (state and body and body.valid) then
    if state then
      state.state = "done"
    end
    return
  end
  local inventory = inventory(body)
  local gear = inventory.get_item_count(PRODUCT_ITEM)
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
  local body = storage.probe.body
  local crafted = state.initial_count
  if body and body.valid then
    crafted = inventory(body).get_item_count(PRODUCT_ITEM)
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
