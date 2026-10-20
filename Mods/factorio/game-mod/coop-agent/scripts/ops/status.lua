-- The status op: what a session needs to bootstrap; needs no map_id.

local body = require("scripts.body")
local body_summary = require("scripts.body.summary")
local host = require("scripts.host")

local M = {}

function M.op(deps)
  local out = {
    mod_version = script.active_mods["coop-agent"],
    map_id = deps.storage.map_id,
    seq = deps.storage.events.head_seq,
    tick = deps.tick,
    body = body_summary.of(body.entity()),
    stopped = deps.storage.body.stopped,
  }
  local player = host.get()
  if player then
    local pos = player.position
    out.host = { name = player.name, connected = player.connected, position = { x = pos.x, y = pos.y } }
  end
  return out
end

return M
