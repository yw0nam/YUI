-- Enemies near a point, along a route and beside a segment: military entities of a force the body's force is_enemy with.

local walker = require("scripts.walker")

local SAMPLE_TILES = 8
local MARGIN_TILES = 4 -- half the sample spacing: every point of a route lies this close to a sample
local AHEAD_TILES = 16

local M = {}

--- The distance from pos to the nearest enemy within the safe radius, or nil. deps: {safe_radius, force}
function M.near(deps, surface, pos)
  local enemy = surface.find_nearest_enemy { position = pos, max_distance = deps.safe_radius, force = deps.force }
  return enemy and walker.distance(pos, enemy.position) or nil
end

-- A point every SAMPLE_TILES along the route, its first and last point included.
local function samples(points)
  local out = { points[1] }
  local carried = 0 -- tiles since the last sample
  for i = 2, #points do
    local a, b = points[i - 1], points[i]
    local length = walker.distance(a, b)
    local at = SAMPLE_TILES - carried
    while at <= length do
      out[#out + 1] = { x = a.x + (b.x - a.x) * at / length, y = a.y + (b.y - a.y) * at / length }
      at = at + SAMPLE_TILES
    end
    carried = (carried + length) % SAMPLE_TILES
  end
  if carried > 0 then
    out[#out + 1] = points[#points]
  end
  return out
end

--- "threat" when an enemy stands within the safe radius + 4 of a sample of the route, else nil.
function M.on_route(deps, surface, points)
  local radius = deps.safe_radius + MARGIN_TILES
  for _, pos in ipairs(samples(points)) do
    if surface.find_nearest_enemy { position = pos, max_distance = radius, force = deps.force } then
      return "threat"
    end
  end
  return nil
end

local function segment_distance(p, a, b)
  local dx, dy = b.x - a.x, b.y - a.y
  local length2 = dx * dx + dy * dy
  local t = length2 > 0 and math.max(0, math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) or 0
  return walker.distance(p, { x = a.x + dx * t, y = a.y + dy * t })
end

--- "threat" when the segment from a to b comes closer to an enemy within the safe radius + 4 of a than a is, else nil.
function M.on_segment(deps, surface, a, b)
  local found = surface.find_entities_filtered {
    position = a,
    radius = deps.safe_radius + MARGIN_TILES,
    is_military_target = true,
  }
  for _, enemy in ipairs(found) do
    local pos = enemy.position
    if deps.force.is_enemy(enemy.force) and segment_distance(pos, a, b) < walker.distance(pos, a) then
      return "threat"
    end
  end
  return nil
end

--- The segment rule over the next 16 tiles of a route: from pos to points[index], then on along the points.
function M.ahead(deps, surface, pos, points, index)
  local walked = 0
  for i = index, #points do
    if walked >= AHEAD_TILES then
      break
    end
    local rejected = M.on_segment(deps, surface, pos, points[i])
    if rejected then
      return rejected
    end
    walked = walked + walker.distance(pos, points[i])
    pos = points[i]
  end
  return nil
end

return M
