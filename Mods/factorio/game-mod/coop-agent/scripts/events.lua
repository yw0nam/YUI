-- Thin event handlers: read the game event and push a plain-data kind onto the ring.

local host = require("scripts.host")
local store = require("scripts.storage")
local snapshot = require("scripts.ops.snapshot")

local M = {}

--- Only the host's chat lines count; commands raise on_console_command instead.
function M.on_console_chat(e)
  local player = host.get()
  if player and e.player_index == player.index then
    store.push("chat", { player = player.name, text = e.message })
  end
end

function M.on_player_joined(e)
  store.push("player_joined", { player = game.get_player(e.player_index).name })
end

function M.on_player_left(e)
  store.push("player_left", { player = game.get_player(e.player_index).name })
end

function M.on_player_died(e)
  store.push("player_died", { player = game.get_player(e.player_index).name })
end

function M.on_research_finished(e)
  store.push("research_finished", { name = e.research.name })
end

function M.on_rocket_launched(_e)
  store.push("rocket_launched", {})
end

function M.summary_tick()
  store.push("snapshot_summary", snapshot.summary())
end

return M
