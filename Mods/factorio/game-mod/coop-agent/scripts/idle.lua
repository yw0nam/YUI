-- Idle modes: follow the host or stand at one position, only while the queue is empty and the gate passes.

local body = require("scripts.body")
local walker = require("scripts.walker")

local FOLLOW_NEAR = 10 -- a follow step ends within this distance of the host
local FOLLOW_FAR = 15 -- a follow step starts beyond this distance
local LEASH = 64 -- beyond this the follow stops and waits for the host
local RETRY_TICKS = 30 -- rest after a failed follow step
local STAY_RADIUS = 2 -- the arrival radius the pathfinder aims at
local STANDING_BY = "Standing by"

local M = {}

--- Cancels the walk: idle owns it only while no job is queued or running.
function M.release(deps)
  if deps.storage.jobs.active == 0 then
    walker.cancel(deps)
  end
end

--- The status part: idle {mode, pos}.
function M.summary(storage)
  return { mode = storage.idle.mode, pos = storage.idle.pos }
end

--- One follow step, shared by the idle mode and the follow job: start a short walk toward the
-- host when too far, wait beyond the leash. Returns the walker's failure, never "arrived".
function M.follow_step(deps)
  local player = deps.host()
  local state = deps.storage.idle
  local dist = walker.distance(body.entity(deps).position, player.position)
  if dist > LEASH then
    if not state.leashed then
      state.leashed = true
      walker.cancel(deps)
    end
    body.set_status(deps, "Waiting for " .. player.name)
    return nil
  end
  if state.leashed then
    state.leashed = nil
    body.set_status(deps, STANDING_BY)
  end
  if not deps.storage.walker and dist > FOLLOW_FAR and deps.tick >= (state.retry_tick or 0) then
    walker.go(deps, player.position, FOLLOW_NEAR)
  end
  local result = walker.tick(deps)
  if result == "arrived" then
    return nil
  end
  if result then
    state.retry_tick = deps.tick + RETRY_TICKS
  end
  return result
end

local function stay_step(deps)
  local pos = deps.storage.idle.pos
  if not pos then
    return
  end
  local result = walker.tick(deps)
  if result then
    deps.storage.idle.pos = nil -- the walk ran once: arrived, or the path is lost
    return
  end
  if not deps.storage.walker then
    walker.go(deps, pos, STAY_RADIUS)
  end
end

--- One idle tick: pick up the start mode once, then run the mode behind the gate.
--- deps: {storage, tick, start_mode, body_name, host(), direction, draw_text}
function M.tick(deps)
  local state = deps.storage.idle
  if state.mode == nil then
    state.mode = deps.start_mode
  end
  if deps.storage.jobs.active > 0 or not body.can_act(deps) then
    return
  end
  if state.mode == "follow" then
    M.follow_step(deps)
  elseif state.mode == "stay" then
    stay_step(deps)
  end
end

--- Sets the mode and stay position; hands the walk over, lifts the latch, rings idle_changed.
function M.set(deps, mode, pos)
  M.release(deps)
  local state = deps.storage.idle
  state.mode, state.pos, state.leashed = mode, pos, nil
  body.clear_latch(deps)
  deps.push("idle_changed", { mode = mode })
end

function M.tick_event()
  if storage.jobs.active > 0 then
    return
  end
  -- the start mode resolves even before the first body exists, so status always carries it
  if storage.body.entity or storage.idle.mode == nil then
    M.tick(M.game_deps())
  end
end

function M.game_deps()
  local deps = body.game_deps()
  deps.start_mode = settings.global["coop-agent-idle-start"].value
  return deps
end

return M
