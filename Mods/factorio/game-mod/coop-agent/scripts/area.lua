-- The 64x64-tile box centred on a position.

local M = {}

function M.around(pos)
  return {
    left_top = { x = pos.x - 32, y = pos.y - 32 },
    right_bottom = { x = pos.x + 32, y = pos.y + 32 },
  }
end

return M
