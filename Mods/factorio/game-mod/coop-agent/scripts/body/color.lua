-- The body color setting's names, mapped to the game's own player colors.

local COLORS = {
  orange = { r = 0.869, g = 0.5, b = 0.130, a = 0.5 },
  red = { r = 0.815, g = 0.024, b = 0.0, a = 0.5 },
  yellow = { r = 0.835, g = 0.666, b = 0.077, a = 0.5 },
  green = { r = 0.093, g = 0.768, b = 0.172, a = 0.5 },
  cyan = { r = 0.275, g = 0.755, b = 0.712, a = 0.5 },
  blue = { r = 0.155, g = 0.540, b = 0.898, a = 0.5 },
  purple = { r = 0.485, g = 0.111, b = 0.659, a = 0.5 },
  white = { r = 0.8, g = 0.8, b = 0.8, a = 0.5 },
}

local M = {}

function M.of(name)
  return COLORS[name]
end

return M
