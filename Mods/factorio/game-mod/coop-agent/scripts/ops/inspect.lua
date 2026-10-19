-- The inspect op: one entity by unit_number, re-resolved around its last
-- indexed position (from find). game.get_entity_by_unit_number covers only
-- prototypes flagged for it, so the index carries the rest.

local RESOLVE_RADIUS = 16

local M = {}

local function resolve(deps, unit_number)
  local info = deps.storage.unit_index[unit_number]
  if info then
    local surface = game.get_surface(info.surface)
    if surface and surface.valid then
      local nearby = surface.find_entities_filtered {
        area = {
          left_top = { x = info.x - RESOLVE_RADIUS, y = info.y - RESOLVE_RADIUS },
          right_bottom = { x = info.x + RESOLVE_RADIUS, y = info.y + RESOLVE_RADIUS },
        },
      }
      for _, entity in ipairs(nearby) do
        if entity.valid and entity.unit_number == unit_number then
          return entity
        end
      end
    end
  end
  local direct = game.get_entity_by_unit_number(unit_number)
  if direct and direct.valid then
    return direct
  end
  return nil
end

local function status_name(status)
  if status == nil then
    return nil
  end
  for name, value in pairs(defines.entity_status) do
    if value == status then
      return name
    end
  end
  return tostring(status)
end

function M.op(deps, args)
  local unit_number = args.unit_number
  if type(unit_number) ~= "number" then
    error("inspect: unit_number must be a number")
  end
  local entity = resolve(deps, unit_number)
  if not entity then
    error("inspect: no entity with unit_number " .. unit_number)
  end

  local pos = entity.position
  deps.storage.unit_index[unit_number] = { surface = entity.surface.name, x = pos.x, y = pos.y }

  local out = {
    unit_number = unit_number,
    name = entity.name,
    type = entity.type,
    position = { x = pos.x, y = pos.y },
    gps = string.format("[gps=%d,%d]", pos.x, pos.y),
    status = status_name(entity.status),
    recipe = nil,
    inventories = {},
    fluids = entity.get_fluid_contents(),
  }
  local recipe = entity.get_recipe and entity.get_recipe()
  if recipe then
    out.recipe = { name = recipe.name }
  end
  for inventory_name, inventory_id in pairs(defines.inventory) do
    local inventory = entity.get_inventory(inventory_id)
    if inventory and inventory.valid then
      local contents = inventory.get_contents()
      if next(contents) ~= nil then
        out.inventories[inventory_name] = contents
      end
    end
  end
  return out
end

return M
