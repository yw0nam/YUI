-- The jobs_cancel op: cancels one active job by id, or all of them; emits no event.

local jobs = require("scripts.jobs")

local M = {}

function M.op(deps, args)
  if args.all == true then
    jobs.cancel(deps, nil)
    return {}
  end
  if type(args.id) ~= "number" then
    return { ok = false, e = "bad_request", m = "id or all expected" }
  end
  if not jobs.cancel(deps, args.id) then
    return { ok = false, e = "bad_request", m = "id: no queued or running job " .. args.id }
  end
  return {}
end

return M
