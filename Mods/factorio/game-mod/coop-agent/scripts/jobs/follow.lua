-- The follow job: repeated short walks toward the host, done when its ticks elapse.

local body = require("scripts.body")
local idle = require("scripts.idle")
local wait = require("scripts.jobs.wait")

local M = {}

M.validate = wait.validate
M.default_timeout = wait.default_timeout

local function following(deps)
  return "Following " .. deps.host().name
end

function M.start(deps)
  body.set_status(deps, following(deps))
end

function M.tick(deps, job)
  local elapsed = deps.tick - job.started_tick
  job.progress = { elapsed = elapsed }
  if elapsed >= job.args.ticks then
    return "done"
  end
  return idle.follow_step(deps, following(deps))
end

return M
