-- The host: the connected admin with the lowest player index, or nil; the probe's dev host when it is loaded.

local surface_of = require("scripts.surface")

local DEV_INTERFACE = "coop-agent-dev"

local M = {}

function M.get()
  if remote.interfaces[DEV_INTERFACE] then
    local pos = remote.call(DEV_INTERFACE, "host_position")
    -- index 0 matches no player, so the dev host never owns a chat line
    return pos and { name = "dev-host", index = 0, connected = true, position = pos, surface = surface_of.get() } or nil
  end
  local host = nil
  for _, player in ipairs(game.connected_players) do
    if player.admin and (host == nil or player.index < host.index) then
      host = player
    end
  end
  return host
end

--- The host when a chat event is the host's line, else nil.
function M.of_chat(e)
  local player = M.get()
  return player and e.player_index == player.index and player or nil
end

return M
