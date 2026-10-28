-- The surface the ops read: nauvis, else the first surface.

local M = {}

function M.get()
  return game.get_surface("nauvis") or game.surfaces[1]
end

return M
