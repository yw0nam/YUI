-- The find op: entities in a bounded area (or around the host player), indexed for inspect.

local gps = require("scripts.gps")
local surface_of = require("scripts.surface")

local MAX_AREA_TILES = 64
local DEFAULT_LIMIT = 100
local MAX_LIMIT = 200

local M = {}

local function area_of(args)
  if type(args.area) == "table" then
    local left_top, right_bottom = args.area.left_top, args.area.right_bottom
    if type(left_top) ~= "table" or type(right_bottom) ~= "table" then
      error("find: area needs left_top and right_bottom positions")
    end
    if type(left_top.x) ~= "number" or type(left_top.y) ~= "number"
      or type(right_bottom.x) ~= "number" or type(right_bottom.y) ~= "number" then
      error("find: area corners need numeric x and y")
    end
    if right_bottom.x - left_top.x > MAX_AREA_TILES or right_bottom.y - left_top.y > MAX_AREA_TILES then
      error("find: area is larger than 64x64 tiles")
    end
    return { left_top = { x = left_top.x, y = left_top.y }, right_bottom = { x = right_bottom.x, y = right_bottom.y } }
  end
  if args.around == "player" then
    local host = game.players[1]
    if not host then
      error('find: around="player" but there is no player')
    end
    local pos = host.position
    return {
      left_top = { x = pos.x - 32, y = pos.y - 32 },
      right_bottom = { x = pos.x + 32, y = pos.y + 32 },
    }
  end
  error('find: give area or around="player"')
end

function M.op(deps, args)
  local area = area_of(args)
  local limit = math.min(type(args.limit) == "number" and args.limit or DEFAULT_LIMIT, MAX_LIMIT)
  if limit < 1 then
    limit = 1
  end

  local filter = { area = area }
  if args.name ~= nil then
    filter.name = args.name
  end
  if args.type ~= nil then
    filter.type = args.type
  end
  local surface = surface_of.get()
  local entities = surface.find_entities_filtered(filter)
  table.sort(entities, function(a, b)
    if a.name ~= b.name then
      return a.name < b.name
    end
    return (a.unit_number or 0) < (b.unit_number or 0)
  end)

  local out = {}
  for _, entity in ipairs(entities) do
    if #out >= limit then
      break
    end
    local pos = entity.position
    out[#out + 1] = {
      unit_number = entity.unit_number,
      name = entity.name,
      type = entity.type,
      position = { x = pos.x, y = pos.y },
      gps = gps.tag(pos.x, pos.y),
      owner = entity.force.name == "player" and "player" or "unknown",
    }
    if entity.unit_number then
      deps.storage.unit_index[entity.unit_number] = { surface = surface.name, x = pos.x, y = pos.y }
    end
  end
  return out
end

return M
