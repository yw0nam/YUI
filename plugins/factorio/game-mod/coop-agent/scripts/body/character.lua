-- The body's character entity: made beside the host from the prototype setting, painted, given the starter kit.

local color = require("scripts.body.color")

local SEARCH_RADIUS = 8

local M = {}

local function prototype_name(deps)
  local proto = deps.entity_prototypes[deps.prototype]
  return proto and proto.type == "character" and deps.prototype or "character"
end

function M.paint(deps, entity)
  entity.color = color.of(deps.color)
end

--- A new character on a free spot beside the host, or nil when none is free.
function M.beside(deps, host)
  local name = prototype_name(deps)
  local pos = host.surface.find_non_colliding_position(name, host.position, SEARCH_RADIUS, 0.5)
  if not pos then
    return nil
  end
  local entity = host.surface.create_entity { name = name, position = pos, force = deps.force }
  if entity then
    M.paint(deps, entity)
  end
  return entity
end

--- Cancels every queued craft; cancelling returns the reserved ingredients to the inventory.
function M.cancel_crafts(entity)
  while entity.crafting_queue_size > 0 do
    entity.cancel_crafting { index = 1, count = entity.crafting_queue[1].count }
  end
end

--- Cancels the crafts, spills every inventory at the body's feet flagged for looting, then destroys the body.
function M.remove(entity)
  M.cancel_crafts(entity)
  for index = 1, entity.get_max_inventory_index() do
    local inventory = entity.get_inventory(index)
    if inventory and not inventory.is_empty() then
      entity.surface.spill_inventory {
        position = entity.position,
        inventory = inventory,
        enable_looted = true,
        allow_belts = false,
      }
    end
  end
  entity.destroy()
end

--- The freeplay scenario's starter items as {name = count}, or nil when freeplay is not running.
function M.freeplay_items()
  local freeplay = remote.interfaces["freeplay"]
  if freeplay and freeplay.get_created_items then
    return remote.call("freeplay", "get_created_items")
  end
  return nil
end

function M.give_kit(deps, entity)
  for name, count in pairs(deps.starter_items() or {}) do
    entity.insert { name = name, count = count }
  end
end

return M
