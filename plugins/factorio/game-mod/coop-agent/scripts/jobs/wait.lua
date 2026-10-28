-- The wait job: done once its ticks have elapsed.

local check = require("scripts.jobs.check")

local M = {}

--- nil for valid args, else the field (nil for args itself) and what was expected.
function M.validate(args)
  local expected = check.positive(args.ticks)
  if expected then
    return "ticks", expected
  end
  return nil
end

function M.default_timeout(args)
  return args.ticks
end

function M.start() end

function M.tick(deps, job)
  local elapsed = deps.tick - job.started_tick
  job.progress = { elapsed = elapsed }
  return elapsed >= job.args.ticks and "done" or nil
end

return M
