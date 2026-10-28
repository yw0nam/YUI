-- The jobs_cancel op: cancels one active job by id, or all of them; emits no event.

local check = require("scripts.jobs.check")
local jobs = require("scripts.jobs")

local M = {}

function M.op(deps, args)
  if args.all == true then
    jobs.cancel(deps, nil)
    return {}
  end
  if type(args.id) ~= "number" then
    return check.bad_request("id or all expected")
  end
  if not jobs.cancel(deps, args.id) then
    return check.bad_request("id: no queued or running job " .. args.id)
  end
  return {}
end

return M
