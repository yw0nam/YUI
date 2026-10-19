-- The inspect op: one entity by unit_number, resolved through the unit index.

local gps = require("scripts.gps")
local unit_index = require("scripts.unit_index")

local CRAFTING_MACHINES = { ["assembling-machine"] = true, furnace = true, ["rocket-silo"] = true }

local M = {}

local function status_name(status)
  for name, value in pairs(defines.entity_status) do
    if value == status then
      return name
    end
  end
  return tostring(status)
end

--- Each non-empty inventory the entity has, by its name, as get_contents() returns it.
local function inventories(entity)
  local out = {}
  for index = 1, entity.get_max_inventory_index() do
    local inventory = entity.get_inventory(index)
    if inventory and not inventory.is_empty() then
      out[entity.get_inventory_name(index)] = inventory.get_contents()
    end
  end
  return out
end

function M.op(_deps, args)
  local unit_number = args.unit_number
  if type(unit_number) ~= "number" then
    error("inspect: unit_number must be a number", 0)
  end
  local entity = unit_index.get(unit_number) or game.get_entity_by_unit_number(unit_number)
  if not (entity and entity.valid) then
    error("inspect: no entity with unit_number " .. unit_number, 0)
  end
  unit_index.add(entity)

  local pos = entity.position
  local out = {
    unit_number = unit_number,
    name = entity.name,
    type = entity.type,
    position = { x = pos.x, y = pos.y },
    gps = gps.tag(pos.x, pos.y),
    inventories = inventories(entity),
    fluids = entity.get_fluid_contents(),
  }
  if CRAFTING_MACHINES[entity.type] then
    local recipe = entity.get_recipe()
    if recipe then
      out.recipe = { name = recipe.name }
    end
  end
  if entity.status then
    out.status = status_name(entity.status)
  end
  return out
end

return M
