-- The 'Holding: <item> <n>' status line the mine and deliver jobs share.

local body = require("scripts.body")

local M = {}

function M.status(deps, item)
  return string.format("Holding: %s %d", item, body.entity(deps).get_item_count(item))
end

return M
