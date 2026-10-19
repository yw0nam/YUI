-- The achievements probe: what the runtime API can say about achievement
-- state after a mod command ran. The API has no read for player achievement
-- state (no LuaPlayer.achievements in 2.0.77), so the probe records that
-- fact rather than inventing numbers.

local spawn = require("scripts.probes.spawn")

local M = {}

function M.start(storage)
  spawn.make_body(storage)
  local player = game.players[1]
  if not player then
    return { state = "done", player = nil, note = "no player" }
  end
  return {
    state = "done",
    player = player.name,
    note = "the runtime API exposes no player achievement state to read",
  }
end

function M.result(storage)
  local state = storage.probe.achievements
  state.result = state.result
    or { probe = "achievements", state = state.state, player = state.player, note = state.note }
  return state.result
end

return M
