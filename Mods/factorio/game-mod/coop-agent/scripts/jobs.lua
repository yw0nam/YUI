-- The job queue and its runner: FIFO, one job at a time, every tick behind the body's execution gate.

local body = require("scripts.body")
local check = require("scripts.jobs.check")
local walker = require("scripts.walker")

local MAX_JOBS = 16
local IDLE_STATUS = "Standing by"

local M = {}

M.KINDS = {
  mine = require("scripts.jobs.mine"),
  walk_to = require("scripts.jobs.walk_to"),
  wait = require("scripts.jobs.wait"),
}

local function active(job)
  return job.state == "queued" or job.state == "running"
end

-- Called only while storage.jobs.active > 0.
local function current(list)
  for _, job in ipairs(list) do
    if active(job) then
      return job
    end
  end
  return nil
end

-- Every end of an active job; a running job's end drops its kind_state, halts the body and sets the status line.
local function close(deps, job, state, reason, status)
  local was_running = job.state == "running"
  job.state, job.reason = state, reason
  deps.storage.jobs.active = deps.storage.jobs.active - 1
  if was_running then
    deps.storage.jobs.kind_state = nil
    walker.cancel(deps)
    body.halt(deps)
    body.set_status(deps, status or IDLE_STATUS)
  end
end

-- Cancels the active job with this id, or every active job when id is nil; true when one matched.
local function cancel_where(deps, id, reason)
  local found = false
  for _, job in ipairs(deps.storage.jobs.list) do
    if active(job) and (id == nil or job.id == id) then
      close(deps, job, "cancelled", reason)
      found = true
    end
  end
  return found
end

local function fail(deps, job, reason, detail)
  close(deps, job, "failed", reason)
  cancel_where(deps, nil, "cancelled")
  local data = {}
  for key, value in pairs(detail or {}) do
    data[key] = value
  end
  data.id, data.kind, data.reason = job.id, job.kind, reason
  deps.push("job_failed", data)
end

local function done(deps, job)
  local done_status = M.KINDS[job.kind].done_status
  close(deps, job, "done", nil, done_status and done_status(deps, job))
  deps.push("job_done", { id = job.id, kind = job.kind })
  if deps.storage.jobs.active == 0 then
    deps.push("queue_idle", { last_job_id = job.id })
  end
end

-- While a job is active: true when the body may act, else a running job fails and queued ones are cancelled.
local function gate(deps)
  if body.can_act(deps) then
    return true
  end
  local reason = body.entity(deps) and "stopped" or "body_dead"
  local job = current(deps.storage.jobs.list)
  if job.state == "running" then
    fail(deps, job, reason)
  else
    cancel_where(deps, nil, reason)
  end
  return false
end

--- One runner tick: start the next job or advance the running one, then check its timeout.
function M.tick(deps)
  if deps.storage.jobs.active == 0 or not gate(deps) then
    return
  end
  local job = current(deps.storage.jobs.list)
  local kind = M.KINDS[job.kind]
  if job.state == "queued" then
    job.state, job.started_tick = "running", deps.tick
    local reason, detail = kind.start(deps, job)
    if not (reason or job.timeout_ticks) then
      reason, detail = "unsupported", { message = job.kind .. " set no timeout_ticks at its start" }
    end
    if reason then
      fail(deps, job, reason, detail)
      return
    end
  end
  local result, detail = kind.tick(deps, job)
  if result == "done" then
    done(deps, job)
  elseif result then
    fail(deps, job, result, detail)
  elseif deps.tick - job.started_tick >= job.timeout_ticks then
    fail(deps, job, "timeout")
  end
end

--- Queues validated specs {kind, args, timeout_ticks?}, then lifts the stop latch; the ids, or a refusal.
function M.enqueue(deps, specs)
  local queue = deps.storage.jobs
  if queue.active + #specs > MAX_JOBS then
    return check.bad_request("jobs: the queue holds at most " .. MAX_JOBS .. " jobs")
  end
  -- a stop since the last tick still ends the queue it halted
  if queue.active > 0 then
    gate(deps)
  end
  local list = queue.list
  local i = 1
  while #list + #specs > MAX_JOBS do
    if active(list[i]) then
      i = i + 1
    else
      table.remove(list, i)
    end
  end
  local ids = {}
  for _, spec in ipairs(specs) do
    local default_timeout = M.KINDS[spec.kind].default_timeout
    local id = queue.next_id
    queue.next_id = id + 1
    list[#list + 1] = {
      id = id,
      kind = spec.kind,
      args = spec.args,
      -- a kind without default_timeout sets it in its start
      timeout_ticks = spec.timeout_ticks or default_timeout and default_timeout(spec.args),
      state = "queued",
    }
    ids[#ids + 1] = id
  end
  queue.active = queue.active + #specs
  body.clear_latch(deps)
  return { ids = ids }
end

--- Cancels the active job with this id, or every active job when id is nil; false when none had the id.
function M.cancel(deps, id)
  return cancel_where(deps, id, "cancelled")
end

--- The status part: active job count and the running job.
function M.summary(storage)
  local queue = storage.jobs
  local job = queue.active > 0 and current(queue.list) or nil
  local running = job and job.state == "running" and { id = job.id, kind = job.kind, progress = job.progress } or nil
  return { length = queue.active, running = running }
end

function M.tick_event()
  if storage.jobs.active > 0 then
    M.tick(body.game_deps())
  end
end

return M
