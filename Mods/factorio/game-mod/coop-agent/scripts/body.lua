-- The body: a playerless character beside the host, its stop latch and execution gate, death and respawn.

local host = require("scripts.host")
local store = require("scripts.storage")
local character = require("scripts.body.character")
local status_line = require("scripts.body.status_line")

local RESPAWN_TICKS = 1800
local ACK_TICKS = 180

local M = {}

--- The live body entity, or nil. deps: {storage}
function M.entity(deps)
  local entity = deps.storage.body.entity
  return entity and entity.valid and entity or nil
end

--- The execution gate: a live body, the stop latch off, the host connected.
function M.can_act(deps)
  return M.entity(deps) ~= nil and not deps.storage.body.stopped and deps.host() ~= nil
end

local function refresh(deps)
  local entity = M.entity(deps)
  if not entity then
    return
  end
  local state = deps.storage.body
  local player = deps.host()
  if player then
    state.host_name = player.name
  end
  local text = status_line.text(deps.body_name, {
    status = state.status,
    stopped = state.stopped,
    waiting_for = not player and state.host_name or nil,
    ack = state.ack_until ~= nil and deps.tick < state.ack_until,
  })
  status_line.show(deps.draw_text, entity, state, text)
end

--- Replaces the state text of the status line.
function M.set_status(deps, text)
  deps.storage.body.status = text
  refresh(deps)
end

--- Lifts the stop latch.
function M.clear_latch(deps)
  deps.storage.body.stopped = false
  refresh(deps)
end

--- The hotkey and the stop op: halt walking, mining and crafting; the first stop latches and emits stopped.
function M.stop(deps)
  local entity = M.entity(deps)
  if entity then
    entity.walking_state = { walking = false, direction = entity.walking_state.direction }
    entity.mining_state = { mining = false }
    character.cancel_crafts(entity)
  end
  if not deps.storage.body.stopped then
    deps.storage.body.stopped = true
    deps.push("stopped", {})
  end
  refresh(deps)
end

--- A host chat line shows "…" for 180 ticks.
function M.acknowledge_chat(deps)
  deps.storage.body.ack_until = deps.tick + ACK_TICKS
  refresh(deps)
end

function M.on_entity_died(deps, e)
  local state = deps.storage.body
  if state.entity and e.entity == state.entity then
    state.entity = nil
    state.unit_number = nil
    state.died_tick = e.tick
    deps.push("body_died", {})
  end
end

local function respawn_due(state, tick)
  return state.died_tick ~= nil and tick - state.died_tick >= RESPAWN_TICKS
end

--- Every 60 ticks and on a coop-agent setting change: remove a disabled body, spawn or respawn beside the host, redraw.
--- deps: {storage, tick, enabled, body_name, prototype, color, host(), push(kind, data), draw_text(spec),
---        entity_prototypes, force, starter_items()}
function M.sweep(deps)
  local state = deps.storage.body
  local entity = M.entity(deps)
  if not deps.enabled then
    if entity then
      character.remove(entity)
    end
    state.entity = nil
    state.unit_number = nil
    return
  end
  local player = deps.host()
  if not entity and player and (state.died_tick == nil or respawn_due(state, deps.tick)) then
    entity = character.beside(deps, player)
    if entity then
      state.entity = entity
      state.unit_number = entity.unit_number
      if not state.kit_given then
        character.give_kit(deps, entity)
        state.kit_given = true
      end
      if state.died_tick then
        state.died_tick = nil
        deps.push("body_respawned", {})
      end
    end
  end
  refresh(deps)
end

function M.game_deps()
  local global = settings.global
  return {
    storage = storage,
    tick = game.tick,
    enabled = global["coop-agent-body-enabled"].value,
    body_name = global["coop-agent-body-name"].value,
    prototype = global["coop-agent-body-prototype"].value,
    color = global["coop-agent-body-color"].value,
    host = host.get,
    push = store.push,
    draw_text = rendering.draw_text,
    entity_prototypes = prototypes.entity,
    force = game.forces.player,
    starter_items = character.freeplay_items,
  }
end

function M.stop_input()
  M.stop(M.game_deps())
end

function M.on_console_chat_event(e)
  if host.of_chat(e) then
    M.acknowledge_chat(M.game_deps())
  end
end

function M.on_entity_died_event(e)
  -- most deaths are not the body's; skip building deps for them
  if storage.body.entity and e.entity == storage.body.entity then
    M.on_entity_died(M.game_deps(), e)
  end
end

function M.on_setting_changed_event(e)
  if string.find(e.setting, "coop-agent-", 1, true) ~= 1 then
    return
  end
  local deps = M.game_deps()
  local entity = M.entity(deps)
  if entity then
    character.paint(deps, entity)
  end
  M.sweep(deps)
end

function M.sweep_tick()
  M.sweep(M.game_deps())
end

return M
