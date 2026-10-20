-- The job queue and its runner: FIFO, one job at a time, every tick behind the body's execution gate.

local body = require("scripts.body")
local walker = require("scripts.walker")

local MAX_JOBS = 16
local IDLE_STATUS = "Standing by"

local M = {}

M.KINDS = {
  walk_to = require("scripts.jobs.walk_to"),
  wait = require("scripts.jobs.wait"),
}

local function active(job)
  return job.state == "queued" or job.state == "running"
end

local function current(list)
  for _, job in ipairs(list) do
    if active(job) then
      return job
    end
  end
  return nil
end

local function active_count(list)
  local count = 0
  for _, job in ipairs(list) do
    if active(job) then
      count = count + 1
    end
  end
  return count
end

-- A running job's end halts the body and returns the status line to standing by.
local function close(deps, job, state, reason)
  local was_running = job.state == "running"
  job.state, job.reason = state, reason
  if was_running then
    walker.cancel(deps)
    local entity = body.entity(deps)
    if entity then
      entity.mining_state = { mining = false }
    end
    body.set_status(deps, IDLE_STATUS)
  end
end

local function fail(deps, job, reason)
  close(deps, job, "failed", reason)
  for _, other in ipairs(deps.storage.jobs.list) do
    if active(other) then
      close(deps, other, "cancelled", "cancelled")
    end
  end
  deps.push("job_failed", { id = job.id, kind = job.kind, reason = reason })
end

local function done(deps, job)
  close(deps, job, "done")
  deps.push("job_done", { id = job.id, kind = job.kind })
  if not current(deps.storage.jobs.list) then
    deps.push("queue_idle", { last_job_id = job.id })
  end
end

--- The gate failure that halts the queue, or nil while the body may act.
local function halted(deps)
  if body.can_act(deps) then
    return nil
  end
  return body.entity(deps) and "stopped" or "body_dead"
end

--- Fails the current job when the gate is shut; true while the queue may run.
local function gate(deps)
  local job = current(deps.storage.jobs.list)
  local reason = job and halted(deps)
  if reason then
    fail(deps, job, reason)
  end
  return reason == nil
end

--- One runner tick: start the next job or advance the running one, then check its timeout.
function M.tick(deps)
  local job = current(deps.storage.jobs.list)
  if not (job and gate(deps)) then
    return
  end
  local kind = M.KINDS[job.kind]
  if job.state == "queued" then
    job.state, job.started_tick = "running", deps.tick
    local reason = kind.start(deps, job)
    if reason then
      fail(deps, job, reason)
      return
    end
  end
  local result = kind.tick(deps, job)
  if result == "done" then
    done(deps, job)
  elseif result then
    fail(deps, job, result)
  elseif deps.tick - job.started_tick >= job.timeout_ticks then
    fail(deps, job, "timeout")
  end
end

--- Queues validated specs {kind, args, timeout_ticks?} and lifts the stop latch; the ids, or a refusal.
--- A stop since the last tick still fails the queue it halted.
function M.enqueue(deps, specs)
  gate(deps)
  local list = deps.storage.jobs.list
  if active_count(list) + #specs > MAX_JOBS then
    return { ok = false, e = "bad_request", m = "jobs: the queue holds at most " .. MAX_JOBS .. " jobs" }
  end
  -- finished records make room oldest first
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
    local id = deps.storage.jobs.next_id
    deps.storage.jobs.next_id = id + 1
    list[#list + 1] = {
      id = id,
      kind = spec.kind,
      args = spec.args,
      timeout_ticks = spec.timeout_ticks or M.KINDS[spec.kind].default_timeout(spec.args),
      state = "queued",
    }
    ids[#ids + 1] = id
  end
  body.clear_latch(deps)
  return { ids = ids }
end

--- Cancels the active job with this id, or every active job when id is nil; false when none had the id.
function M.cancel(deps, id)
  local found = false
  for _, job in ipairs(deps.storage.jobs.list) do
    if active(job) and (id == nil or job.id == id) then
      close(deps, job, "cancelled", "cancelled")
      found = true
    end
  end
  return found
end

--- The status part: active job count and the running job.
function M.summary(storage)
  local running = nil
  for _, job in ipairs(storage.jobs.list) do
    if job.state == "running" then
      running = { id = job.id, kind = job.kind, progress = job.progress }
    end
  end
  return { length = active_count(storage.jobs.list), running = running }
end

function M.tick_event()
  if current(storage.jobs.list) then
    M.tick(walker.game_deps())
  end
end

return M
