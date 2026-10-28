-- The clickable chat position tag.

local M = {}

function M.tag(x, y)
  return string.format("[gps=%d,%d]", math.floor(x), math.floor(y))
end

return M
