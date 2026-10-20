-- The body's character entity: made beside the host from the prototype setting, painted, given the starter kit.

local color = require("scripts.body.color")

local SEARCH_RADIUS = 8

local M = {}

local function prototype_name()
  local name = settings.global["coop-agent-body-prototype"].value
  local proto = prototypes.entity[name]
  return proto and proto.type == "character" and name or "character"
end

function M.paint(entity)
  entity.color = color.of(settings.global["coop-agent-body-color"].value)
end

--- A new character on a free spot beside the host, or nil when none is free.
function M.beside(host)
  local name = prototype_name()
  local pos = host.surface.find_non_colliding_position(name, host.position, SEARCH_RADIUS, 0.5)
  if not pos then
    return nil
  end
  local entity = host.surface.create_entity { name = name, position = pos, force = game.forces.player }
  if entity then
    M.paint(entity)
  end
  return entity
end

--- Spills every inventory at the body's feet, flagged for looting, then destroys the body.
function M.remove(entity)
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

--- The freeplay scenario's starter items; nothing when freeplay is not running.
function M.give_kit(entity)
  local freeplay = remote.interfaces["freeplay"]
  if not (freeplay and freeplay.get_created_items) then
    return
  end
  for name, count in pairs(remote.call("freeplay", "get_created_items")) do
    entity.insert { name = name, count = count }
  end
end

return M
