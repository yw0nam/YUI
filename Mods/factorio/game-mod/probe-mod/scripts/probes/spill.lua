-- The spill probe: coal spilled with enable_looted=true, reporting each item entity's count and to_be_looted.

local spawn = require("scripts.probes.spawn")

local M = {}

function M.start(storage)
  local body = spawn.make_body(storage)
  local pos = body.position
  local place = body.surface.find_non_colliding_position("item-on-ground", { x = pos.x - 2, y = pos.y }, 8, 1)
    or { x = pos.x - 2, y = pos.y }
  local spilled = body.surface.spill_item_stack {
    position = place,
    stack = { name = "coal", count = 20 },
    enable_looted = true,
    allow_belts = false,
    max_radius = 4,
  }
  local entities = {}
  for _, entity in ipairs(spilled or {}) do
    entities[#entities + 1] = {
      name = entity.name,
      count = entity.stack.count,
      to_be_looted = entity.to_be_looted,
      position = { x = math.floor(entity.position.x * 10) / 10, y = math.floor(entity.position.y * 10) / 10 },
    }
  end
  return { state = "done", entities = entities }
end

function M.result(storage)
  local state = storage.probe.spill
  state.result = state.result
    or { probe = "spill", state = state.state, entities = state.entities, error = state.error }
  return state.result
end

return M
