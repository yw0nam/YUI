-- Idle modes: follow the host or stand at one position, only while the queue is empty and the gate passes.

local body = require("scripts.body")
local host = require("scripts.host")
local status_line = require("scripts.body.status_line")
local store = require("scripts.storage")
local walker = require("scripts.walker")

local FOLLOW_NEAR = 10 -- a follow step ends within this distance of the host
local FOLLOW_FAR = 15 -- a follow step starts beyond this distance
local LEASH = 64 -- beyond this the follow stops and waits for the host
local RETRY_TICKS = 30 -- rest after one failed follow step
local STEP_FAILURES = 3 -- failed steps before the follow waits for a reachable host
local UNREACHABLE_TICKS = 600 -- the wait after three failed steps
local RECHECK_TICKS = 10 -- ticks between follow distance checks while no walk is under way
local STAY_RADIUS = 2 -- the arrival radius the pathfinder aims at

local M = {}

--- The status part: idle {mode, pos}; an explicit idle_set mode wins over the start setting.
function M.summary(deps)
  local idle = deps.storage.idle
  return { mode = idle.mode or deps.start_mode, pos = idle.pos }
end

local function same_position(a, b)
  return a ~= nil and b ~= nil and a.x == b.x and a.y == b.y
end

--- Drops the follow step's leash, failure count and wait; a new owner of the step starts afresh.
function M.reset_follow(deps)
  local state = deps.storage.idle
  state.leashed, state.failures, state.retry_tick = nil, nil, nil
end

--- One follow step, shared by the idle mode and the follow job: start a short walk toward the host
-- when too far, wait beyond the leash, show label back inside it. Returns the walker's failure, never "arrived".
function M.follow_step(deps, label)
  local entity = body.entity(deps)
  local player = deps.host()
  local state = deps.storage.idle
  -- host.get already reports the physical self; another surface is as good as beyond the leash
  local dist = player.surface == entity.surface and walker.distance(entity.position, player.position) or LEASH + 1
  if dist > LEASH then
    if not state.leashed then
      state.leashed = true
      walker.cancel(deps)
      body.set_status(deps, "Waiting for " .. player.name)
    end
    return nil
  end
  if state.leashed and not (state.retry_tick ~= nil and deps.tick < state.retry_tick) then
    state.leashed = nil
    body.set_status(deps, label)
  end
  if deps.storage.walker and dist <= FOLLOW_NEAR then
    state.failures = nil
    walker.cancel(deps) -- the host came within reach: the step ends at once
    return nil
  end
  if not deps.storage.walker and dist > FOLLOW_FAR and deps.tick >= (state.retry_tick or 0) then
    walker.go(deps, player.position, FOLLOW_NEAR)
  end
  local result = walker.tick(deps)
  if result == "arrived" then
    state.failures = nil
    return nil
  end
  if result then
    state.failures = (state.failures or 0) + 1
    if state.failures >= STEP_FAILURES then
      -- the host cannot be reached inside the leash: wait a while and say so
      state.failures, state.retry_tick, state.leashed = nil, deps.tick + UNREACHABLE_TICKS, true
      body.set_status(deps, "Waiting for " .. player.name)
    else
      state.retry_tick = deps.tick + RETRY_TICKS
    end
  end
  return result
end

local function stay_step(deps)
  local state = deps.storage.idle
  if state.arrived or state.pos == nil then
    return
  end
  local result = walker.tick(deps)
  if result then
    state.arrived = true -- the walk ran once: arrived, or the path is lost
    return
  end
  if not deps.storage.walker then
    walker.go(deps, state.pos, STAY_RADIUS)
  end
end

local function follow_idle(deps)
  M.follow_step(deps, status_line.STANDING_BY)
end

M.MODES = { follow = follow_idle, stay = stay_step }

--- One idle tick behind the gate; a gate that shut mid-step takes the walk away at once.
--- deps: {storage, tick, start_mode, body_name, host(), direction, draw_text}
function M.tick(deps)
  local state = deps.storage.idle
  if deps.storage.jobs.active > 0 then
    return
  end
  if not body.can_act(deps) then
    if deps.storage.walker then
      walker.cancel(deps) -- a respawned body never resumes the old path
    end
    return
  end
  M.MODES[state.mode or deps.start_mode](deps)
end

-- A new mode starts afresh: takes the walk, drops the follow state and the stay arrival, resets a leash's label.
local function reset(deps)
  if deps.storage.jobs.active == 0 then
    walker.cancel(deps) -- idle owns the walk only while the queue is empty
  end
  local state = deps.storage.idle
  if state.leashed then
    body.set_status(deps, status_line.STANDING_BY)
  end
  M.reset_follow(deps)
  state.arrived = nil
end

--- Sets the mode and stay position; takes the walk, resets the label, lifts the latch, rings on a change.
function M.set(deps, mode, pos)
  local state = deps.storage.idle
  local previous = state.mode or deps.start_mode
  local changed = previous ~= mode or (mode == "stay" and not same_position(state.pos, pos))
  state.mode, state.pos = mode, pos
  reset(deps)
  body.clear_latch(deps)
  if changed then
    deps.push("idle_changed", { mode = mode })
  end
end

--- The start setting changed: an explicit idle_set stands; otherwise the mode moves with it like an idle_set.
function M.on_setting_changed(deps, e)
  if e.setting ~= "coop-agent-idle-start" or deps.storage.idle.mode ~= nil then
    return
  end
  reset(deps)
  deps.push("idle_changed", { mode = deps.start_mode })
end

local function game_deps()
  return {
    storage = storage,
    tick = game.tick,
    body_name = settings.global["coop-agent-body-name"].value,
    start_mode = settings.global["coop-agent-idle-start"].value,
    host = host.get,
    push = store.push,
    direction = defines.direction,
    draw_text = rendering.draw_text,
  }
end

function M.on_setting_changed_event(e)
  M.on_setting_changed(game_deps(), e)
end

--- The per-tick entry: due checks run without deps; the deps are built only for a due tick.
function M.tick_event()
  if storage.jobs.active > 0 then
    return
  end
  local state = storage.idle
  if storage.walker == nil then
    if storage.body.entity == nil or storage.body.stopped then
      return -- nothing walks and the body cannot act
    end
    local mode = state.mode or settings.global["coop-agent-idle-start"].value
    if mode == "stay" then
      if state.arrived or state.pos == nil then
        return -- stood where asked
      end
    elseif game.tick % RECHECK_TICKS ~= 0 then
      return -- inside the band: the follow distance check runs on every 10th tick
    end
  end
  M.tick(game_deps())
end

return M
