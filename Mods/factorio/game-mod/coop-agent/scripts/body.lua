-- The body: a playerless character beside the host, its stop latch and execution gate, death and respawn.

local host = require("scripts.host")
local store = require("scripts.storage")
local character = require("scripts.body.character")
local status_line = require("scripts.body.status_line")

local RESPAWN_TICKS = 1800
local ACK_TICKS = 180

local M = {}

local function enabled()
  return settings.global["coop-agent-body-enabled"].value
end

--- The live body entity, or nil.
function M.entity()
  local unit_number = storage.body.unit_number
  local entity = unit_number and game.get_entity_by_unit_number(unit_number)
  return entity and entity.valid and entity or nil
end

--- The execution gate: a live body, the stop latch off, the host connected.
function M.can_act()
  return M.entity() ~= nil and not storage.body.stopped and host.get() ~= nil
end

local function refresh()
  local entity = M.entity()
  if not entity then
    return
  end
  local state = storage.body
  local player = host.get()
  if player then
    state.host_name = player.name
  end
  local text = status_line.text(settings.global["coop-agent-body-name"].value, {
    status = state.status,
    stopped = state.stopped,
    waiting_for = not player and state.host_name or nil,
    ack = state.ack_until ~= nil and game.tick < state.ack_until,
  })
  status_line.show(entity, state, text)
end

--- The job runner's state text for the status line, e.g. "Walking to <target>".
function M.set_status(text)
  storage.body.status = text
  refresh()
end

--- A new job or idle_set lifts the stop latch.
function M.clear_latch()
  storage.body.stopped = false
  refresh()
end

--- The hotkey and the stop op: halt walking, mining and crafting, latch Stopped, emit stopped.
function M.stop()
  local entity = M.entity()
  if entity then
    entity.walking_state = { walking = false, direction = entity.walking_state.direction }
    entity.mining_state = { mining = false }
    while entity.crafting_queue_size > 0 do
      entity.cancel_crafting { index = 1, count = entity.crafting_queue[1].count }
    end
  end
  storage.body.stopped = true
  store.push("stopped", {})
  refresh()
end

--- A host chat line shows "…" for 180 ticks.
function M.acknowledge_chat()
  storage.body.ack_until = game.tick + ACK_TICKS
  refresh()
end

function M.respawn_due(tick)
  local died_tick = storage.body.died_tick
  return enabled() and died_tick ~= nil and tick - died_tick >= RESPAWN_TICKS
end

function M.on_entity_died(e)
  local state = storage.body
  if state.unit_number and e.entity.unit_number == state.unit_number then
    state.unit_number = nil
    state.died_tick = e.tick
    store.push("body_died", {})
  end
end

--- Every 60 ticks and on a setting change: remove a disabled body, spawn or respawn beside the host, redraw.
function M.sweep()
  local state = storage.body
  local entity = M.entity()
  if not enabled() then
    if entity then
      entity.destroy()
    end
    state.unit_number = nil
    return
  end
  local player = host.get()
  if not entity and player and (state.died_tick == nil or M.respawn_due(game.tick)) then
    entity = character.beside(player)
    if entity then
      state.unit_number = entity.unit_number
      if not state.kit_given then
        character.give_kit(entity)
        state.kit_given = true
      end
      if state.died_tick then
        state.died_tick = nil
        store.push("body_respawned", {})
      end
    end
  end
  refresh()
end

function M.on_setting_changed()
  local entity = M.entity()
  if entity then
    character.paint(entity)
  end
  M.sweep()
end

return M
