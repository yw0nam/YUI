-- The entities find and inspect returned, newest 4096 kept, so inspect resolves a unit_number.

local CAP = 4096

local M = {}

function M.add(entity)
  local index = storage.unit_index
  if not index.map[entity.unit_number] then
    index.order[#index.order + 1] = entity.unit_number
  end
  index.map[entity.unit_number] = entity
  while #index.order > CAP do
    index.map[table.remove(index.order, 1)] = nil
  end
end

function M.get(unit_number)
  local entity = storage.unit_index.map[unit_number]
  return entity and entity.valid and entity or nil
end

function M.sweep()
  local index = storage.unit_index
  local order = {}
  for _, unit_number in ipairs(index.order) do
    if index.map[unit_number].valid then
      order[#order + 1] = unit_number
    else
      index.map[unit_number] = nil
    end
  end
  index.order = order
end

return M
