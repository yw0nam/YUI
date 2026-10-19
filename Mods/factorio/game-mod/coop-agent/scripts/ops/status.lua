-- The status op: what a session needs to bootstrap; needs no map_id.

local M = {}

function M.op(deps)
  local out = {
    mod_version = script.active_mods["coop-agent"],
    map_id = deps.storage.map_id,
    seq = deps.storage.events.head_seq,
    tick = deps.tick,
  }
  local host = game.players[1]
  if host then
    local pos = host.position
    out.host = { name = host.name, connected = host.connected, position = { x = pos.x, y = pos.y } }
  end
  return out
end

return M
