-- The ping op: a chart tag swept away ten minutes later, plus a [gps] chat line.

local gps = require("scripts.gps")
local surface_of = require("scripts.surface")
local utf8 = require("scripts.utf8")

local PING_TTL_TICKS = 36000
local MAX_CHARS = 60

local M = {}

function M.op(deps, args)
  local pos = args.pos
  if type(pos) ~= "table" or type(pos.x) ~= "number" or type(pos.y) ~= "number" then
    error("ping: pos must be {x, y}")
  end
  local text = args.text
  local chars = type(text) == "string" and utf8.len(text) or nil
  if not chars or chars == 0 or chars > MAX_CHARS then
    error("ping: text must be 1 to " .. MAX_CHARS .. " characters of valid UTF-8")
  end

  local surface = surface_of.get()
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

  game.print(gps.tag(pos.x, pos.y) .. " " .. text)
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
