-- The host: the connected admin with the lowest player index, or nil.

local M = {}

function M.get()
  local host = nil
  for _, player in ipairs(game.connected_players) do
    if player.admin and (host == nil or player.index < host.index) then
      host = player
    end
  end
  return host
end

return M
