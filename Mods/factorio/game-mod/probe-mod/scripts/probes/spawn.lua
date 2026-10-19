-- The spawn probe: a playerless character at the force spawn.

local probe_body = require("scripts.body")

local M = {}

function M.start(storage)
  probe_body.make(storage)
  return { state = "done" }
end

function M.result(storage)
  local body = storage.probe.body
  local result = { probe = "spawn", state = "done", spawned = body ~= nil and body.valid }
  if body and body.valid then
    local pos = body.position
    result.unit_number = body.unit_number
    result.position = { x = pos.x, y = pos.y }
  end
  return result
end

return M
