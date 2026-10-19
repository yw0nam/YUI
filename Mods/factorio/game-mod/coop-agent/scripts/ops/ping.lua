-- The ping op: a chart tag the agent placed, expired by the on_nth_tick(600)
-- sweep 10 minutes later, plus a [gps] chat line.

local PING_TTL_TICKS = 36000
local MAX_CHARS = 60

local M = {}

function M.op(deps, args)
  local pos = args.pos
  if type(pos) ~= "table" or type(pos.x) ~= "number" or type(pos.y) ~= "number" then
    error("ping: pos must be {x, y}")
  end
  local text = args.text
  if type(text) ~= "string" or #text == 0 or #text > MAX_CHARS then
    error("ping: text must be a string of 1 to " .. MAX_CHARS .. " characters")
  end

  local surface = game.get_surface("nauvis") or game.surfaces[1]
  local force = game.forces.player
  force.chart(surface, {
    left_top = { x = pos.x - 32, y = pos.y - 32 },
    right_bottom = { x = pos.x + 32, y = pos.y + 32 },
  })
  local tag = force.add_chart_tag(surface, { position = { x = pos.x, y = pos.y }, text = text })
  if not tag then
    error("ping: the position does not accept a chart tag")
  end
  deps.storage.pings[tag.tag_number] = { tag = tag, expire_tick = deps.tick + PING_TTL_TICKS }

  game.print(string.format("[gps=%d,%d] %s", pos.x, pos.y, text))
  return { tag_id = tag.tag_number }
end

function M.sweep_tick()
  local now = game.tick
  for tag_number, entry in pairs(storage.pings) do
    if not entry.tag.valid then
      storage.pings[tag_number] = nil
    elseif now >= entry.expire_tick then
      entry.tag.destroy()
      storage.pings[tag_number] = nil
    end
  end
end

return M
