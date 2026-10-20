-- The stop op: the same stop as the hotkey.

local body = require("scripts.body")

local M = {}

function M.op()
  body.stop(body.game_deps())
  return {}
end

return M
