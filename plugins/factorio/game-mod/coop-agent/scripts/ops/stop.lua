-- The stop op: the same stop as the hotkey.

local body = require("scripts.body")

local M = {}

function M.op(deps)
  body.stop(deps)
  return {}
end

return M
