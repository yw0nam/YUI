-- The jobs op: every record the queue holds, oldest first.

local M = {}

function M.op(deps)
  return deps.storage.jobs.list
end

return M
