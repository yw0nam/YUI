-- Threat safety: an enemy near the body or its damage cancels every job and retreats the body toward the host;
-- the queue and idle wait until the retreat ends and 600 ticks pass with no enemy near the body.

local body = require("scripts.body")
local enemies = require("scripts.threat.enemies")
local hostile = require("scripts.hostile")
local idle = require("scripts.idle")
local jobs = require("scripts.jobs")
local status_line = require("scripts.body.status_line")
local walker = require("scripts.walker")

local RETREAT_RADIUS = 5
local QUIET_TICKS = 600
local DAMAGE_TICKS = 300

local M = {}

--- Installs the walker's route hooks on deps and returns it: a retreat's route and segments never come closer to a
--- known enemy; any other route keeps the safe radius + 4 at every 8-tile sample. A hit rejects with "threat".
function M.with_route_checks(deps)
  local state = deps.storage.threat
  deps.on_path = function(path)
    local entity = body.entity(deps)
    if not entity then
      return nil
    end
    local hit
    if state.retreating then
      hit = enemies.ahead_closer(deps, entity.surface, entity.position, path, 1)
    else
      hit = enemies.on_route(deps, entity.surface, path)
    end
    return hit and "threat" or nil
  end
  deps.on_segment = function(from, to)
    local hit = state.retreating and enemies.ahead_closer(deps, body.entity(deps).surface, from, { to }, 1)
    return hit and "threat" or nil
  end
  return deps
end

-- The retreat is over: the body stands and the quiet period starts.
local function stand(deps)
  local state = deps.storage.threat
  state.retreating, state.calm_tick = nil, deps.tick + QUIET_TICKS
  walker.cancel(deps)
  body.set_status(deps, status_line.STANDING_BY)
end

-- Cancels every job; a retreat under way goes on, else one starts toward the host, or the body stands where an
-- enemy is within the safe radius of the host.
local function alarm(deps)
  local state = deps.storage.threat
  state.active = true
  jobs.cancel(deps, nil, "threat")
  if state.retreating then
    return
  end
  idle.reset_follow(deps)
  local host = deps.host()
  local entity = body.entity(deps)
  if host.surface ~= entity.surface or enemies.near(deps, host.surface, host.position) then
    stand(deps)
    return
  end
  state.retreating, state.calm_tick = true, nil
  walker.cancel(deps)
  walker.go(deps, host.position, RETREAT_RADIUS)
  body.set_status(deps, "Retreating")
end

--- The body check every 60 ticks while the gate passes: an enemy within the safe radius rings body_threat once
--- per threat and raises the alarm; a retreat re-checks its next 16 tiles; the threat ends after its quiet period.
--- deps: body.game_deps() through with_route_checks
function M.sweep(deps)
  if not body.can_act(deps) then
    return
  end
  local state = deps.storage.threat
  local entity = body.entity(deps)
  local distance = enemies.near(deps, entity.surface, entity.position)
  if distance then
    if not state.active then
      deps.push("body_threat", { distance = math.floor(distance + 0.5) })
    end
    alarm(deps)
  end
  if state.retreating then
    local path, index = walker.route(deps)
    if path and enemies.ahead_closer(deps, entity.surface, entity.position, path, index) then
      stand(deps)
    end
  elseif state.active and deps.tick >= state.calm_tick then
    state.active = nil
  end
end

--- One retreat tick: a shut gate or the walk's end, arrived or not, ends the retreat.
function M.tick(deps)
  if not deps.storage.threat.retreating then
    return
  end
  if not body.can_act(deps) or walker.tick(deps) then
    stand(deps)
  end
end

--- Enemy damage to the body: body_damaged{health} at most once per 300 ticks, each one with the alarm.
--- e: {force?, cause?, final_health}, the on_entity_damaged fields
function M.on_damaged(deps, e)
  local state = deps.storage.threat
  if not hostile.is_enemy(deps.force, e.force, hostile.cause_force(e)) then
    return
  end
  if state.damaged_tick and deps.tick - state.damaged_tick < DAMAGE_TICKS then
    return
  end
  state.damaged_tick = deps.tick
  deps.push("body_damaged", { health = e.final_health })
  if body.can_act(deps) then
    alarm(deps)
  end
end

local function game_deps()
  return M.with_route_checks(body.game_deps())
end

--- Every pathfinder answer passes the threat's route check.
function M.on_path_finished_event(e)
  walker.on_path_finished(game_deps(), e)
end

function M.tick_event()
  if storage.threat.retreating then
    M.tick(game_deps())
  end
end

function M.sweep_tick()
  M.sweep(game_deps())
end

function M.on_damaged_event(e)
  -- most damage is not the body's; skip building deps for it
  if storage.body.entity and e.entity == storage.body.entity then
    M.on_damaged(game_deps(), e)
  end
end

return M
