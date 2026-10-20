-- The follow job: repeated short walks toward the host, done when its ticks elapse.

local body = require("scripts.body")
local check = require("scripts.jobs.check")
local idle = require("scripts.idle")

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

function M.start(deps)
  body.set_status(deps, "Following " .. deps.host().name)
end

function M.tick(deps, job)
  local elapsed = deps.tick - job.started_tick
  job.progress = { elapsed = elapsed }
  if elapsed >= job.args.ticks then
    return "done"
  end
  return idle.follow_step(deps)
end

return M
