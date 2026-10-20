-- Threat safety: an enemy near the body or its damage ends the queue and retreats the body toward the host; the
-- queue and idle wait until the retreat ends and 600 ticks pass with no enemy near the body.

local body = require("scripts.body")
local enemies = require("scripts.threat.enemies")
local hostile = require("scripts.hostile")
local idle = require("scripts.idle")
local jobs = require("scripts.jobs")
local status_line = require("scripts.body.status_line")
local walker = require("scripts.walker")

local RETREAT_RADIUS = 5
local RETRY_TICKS = 300
local QUIET_TICKS = 600
local DAMAGE_TICKS = 300
local RETREATING = "Retreating"

local M = {}

--- Installs the walker's route hook on deps and returns it: a retreat's route never comes closer to a known enemy,
--- any other route keeps the safe radius + 4 at every 8-tile sample. A hit rejects the route with "threat".
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
  return deps
end

-- The retreat is over: the body stands and the quiet period starts.
local function stand(deps)
  local state = deps.storage.threat
  state.retreating, state.goal, state.retry_tick = nil, nil, nil
  state.calm_tick = deps.tick + QUIET_TICKS
  walker.cancel(deps)
  body.set_status(deps, status_line.STANDING_BY)
end

-- Walks toward the host, or stands where an enemy is within the safe radius of the host.
local function retreat(deps)
  local state = deps.storage.threat
  local host = deps.host()
  local entity = body.entity(deps)
  walker.cancel(deps)
  if host.surface ~= entity.surface or enemies.near(deps, host.surface, host.position) then
    stand(deps)
    return
  end
  state.retreating, state.retry_tick, state.calm_tick = true, nil, nil
  state.goal = { x = host.position.x, y = host.position.y }
  walker.go(deps, state.goal, RETREAT_RADIUS)
  body.set_status(deps, RETREATING)
end

-- Ends the queue with threat; a retreat under way goes on, else one starts and idle starts afresh after it.
local function alarm(deps)
  local state = deps.storage.threat
  state.active = true
  jobs.abort(deps, "threat")
  if not state.retreating then
    idle.restart(deps)
    retreat(deps)
  end
end

-- The look-ahead over the walk's next 16 tiles: a retreat's segments must not come closer to an enemy, any other
-- walk keeps the safe radius + 4; a hit ends the walk with "threat" on its next tick.
local function look_ahead(deps, entity)
  local path, index = walker.route(deps)
  if not path then
    return
  end
  local check = deps.storage.threat.retreating and enemies.ahead_closer or enemies.ahead_near
  if check(deps, entity.surface, entity.position, path, index) then
    walker.reject(deps, "threat")
  end
end

--- The body check every 60 ticks while the gate passes: an enemy within the safe radius rings body_threat on the
--- first sighting of a threat and raises the alarm; a retreat follows a host that moved more than 5 tiles; every
--- walk looks 16 tiles ahead; the threat ends after its quiet period. deps: body.game_deps() through with_route_checks
function M.sweep(deps)
  if not body.can_act(deps) then
    return
  end
  local state = deps.storage.threat
  local entity = body.entity(deps)
  local distance = enemies.near(deps, entity.surface, entity.position)
  if distance then
    if not state.sighted then
      state.sighted = true
      deps.push("body_threat", { distance = math.floor(distance + 0.5) })
    end
    alarm(deps)
  end
  if state.retreating and walker.distance(deps.host().position, state.goal) > RETREAT_RADIUS then
    retreat(deps)
  end
  look_ahead(deps, entity)
  if state.active and not state.retreating and deps.tick >= state.calm_tick then
    state.active, state.sighted = nil, nil
  end
end

--- One retreat tick: a rejected route stands and retries 300 ticks later; a shut gate or any other end of the walk
--- ends the retreat.
function M.tick(deps)
  local state = deps.storage.threat
  if not state.retreating then
    return
  end
  if not body.can_act(deps) then
    stand(deps)
    return
  end
  if not walker.walking(deps) then
    if deps.tick < state.retry_tick then
      return
    end
    walker.go(deps, state.goal, RETREAT_RADIUS)
  end
  local result = walker.tick(deps)
  if result == "threat" then
    state.retry_tick = deps.tick + RETRY_TICKS
  elseif result then
    stand(deps)
  end
end

--- Enemy damage to the body: body_damaged{health} at most once per 300 ticks, each one with the alarm while the
--- gate passes. e: {force?, cause?, final_health}, the on_entity_damaged fields
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
  local state = storage.threat
  -- a rejected retreat route waits for its retry without building deps
  if state.retreating and (storage.walker or game.tick >= state.retry_tick) then
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
