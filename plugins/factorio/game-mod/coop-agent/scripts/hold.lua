-- Who holds the body: the queue while a job is queued or running, a threat until its quiet period ends.

local M = {}

--- True while a threat holds the body: the queue starts no job and idle does nothing.
function M.threat(storage)
  return storage.threat.active == true
end

--- True while idle must not act: a job is queued or running, or a threat holds the body.
function M.idle(storage)
  return storage.jobs.active > 0 or M.threat(storage)
end

return M
