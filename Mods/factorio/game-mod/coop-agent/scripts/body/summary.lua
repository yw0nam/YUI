-- The body part of status: alive, and for a live body its position, health and main inventory's top 10 by count.

local TOP_ITEMS = 10

local M = {}

local function inventory(entity)
  local totals = {}
  for _, item in ipairs(entity.get_inventory(defines.inventory.character_main).get_contents()) do
    totals[item.name] = (totals[item.name] or 0) + item.count
  end
  local out = {}
  for name, count in pairs(totals) do
    out[#out + 1] = { name = name, count = count }
  end
  table.sort(out, function(a, b)
    if a.count ~= b.count then
      return a.count > b.count
    end
    return a.name < b.name
  end)
  for i = #out, TOP_ITEMS + 1, -1 do
    out[i] = nil
  end
  return out
end

function M.of(entity)
  if not entity then
    return { alive = false }
  end
  local pos = entity.position
  return { alive = true, position = { x = pos.x, y = pos.y }, health = entity.health, inventory = inventory(entity) }
end

return M
