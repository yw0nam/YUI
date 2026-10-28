-- Enemies near a point, along a route and ahead on it: military entities of a force the body's force is_enemy with.

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

--- True when an enemy stands within the safe radius + 4 of a sample of the route.
function M.on_route(deps, surface, points)
  local radius = deps.safe_radius + MARGIN_TILES
  for _, pos in ipairs(samples(points)) do
    if surface.find_nearest_enemy { position = pos, max_distance = radius, force = deps.force } then
      return true
    end
  end
  return false
end

-- Military entities of the forces the body's force is_enemy with, within radius of pos. deps: {force, forces}
local function enemies_around(deps, surface, pos, radius)
  local forces = {}
  for _, force in pairs(deps.forces) do
    if deps.force.is_enemy(force) then
      forces[#forces + 1] = force
    end
  end
  if #forces == 0 then
    return {}
  end
  return surface.find_entities_filtered { position = pos, radius = radius, force = forces, is_military_target = true }
end

-- The route's segments from pos through points[index] onward, until 16 tiles are covered.
local function segments(pos, points, index)
  local out, walked = {}, 0
  for i = index, #points do
    if walked >= AHEAD_TILES then
      break
    end
    out[#out + 1] = { a = pos, b = points[i] }
    walked = walked + walker.distance(pos, points[i])
    pos = points[i]
  end
  return out
end

local function segment_distance(p, a, b)
  local dx, dy = b.x - a.x, b.y - a.y
  local length2 = dx * dx + dy * dy
  local t = length2 > 0 and math.max(0, math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) or 0
  return walker.distance(p, { x = a.x + dx * t, y = a.y + dy * t })
end

-- True when hit(enemy position, segment, reach) holds for an enemy and a segment of the route's next 16 tiles,
-- from pos through points[index] onward; one query covers every segment.
local function ahead(deps, surface, pos, points, index, hit)
  local reach = deps.safe_radius + MARGIN_TILES
  local found = enemies_around(deps, surface, pos, reach + AHEAD_TILES)
  for _, segment in ipairs(segments(pos, points, index)) do
    for _, enemy in ipairs(found) do
      if hit(enemy.position, segment, reach) then
        return true
      end
    end
  end
  return false
end

--- True when the route's next 16 tiles pass within the safe radius + 4 of an enemy.
function M.ahead_near(deps, surface, pos, points, index)
  return ahead(deps, surface, pos, points, index, function(at, segment, reach)
    return segment_distance(at, segment.a, segment.b) <= reach
  end)
end

--- True when a segment of the route's next 16 tiles comes closer to an enemy within the safe radius + 4 of the
--- segment's start than that start is.
function M.ahead_closer(deps, surface, pos, points, index)
  return ahead(deps, surface, pos, points, index, function(at, segment, reach)
    local from_start = walker.distance(at, segment.a)
    return from_start <= reach and segment_distance(at, segment.a, segment.b) < from_start
  end)
end

return M
