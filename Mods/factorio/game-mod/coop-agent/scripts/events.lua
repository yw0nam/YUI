-- Thin event handlers: read the game event, push a plain-data kind onto the
-- ring. Registered in control.lua at the root.

local ring = require("scripts.ring")
local snapshot = require("scripts.ops.snapshot")

local M = {}

local function push(kind, data)
  ring.push(storage.events, game.tick, kind, data)
end

--- Chat fires only for an admin's own console lines; commands raise
--- on_console_command instead, so they can never land here.
function M.on_console_chat(e)
  if not e.player_index then
    return
  end
  local player = game.get_player(e.player_index)
  if not (player and player.admin) then
    return
  end
  push("chat", { player = player.name, text = e.message })
end

function M.on_player_joined(e)
  push("player_joined", { player = game.get_player(e.player_index).name })
end

function M.on_player_left(e)
  push("player_left", { player = game.get_player(e.player_index).name })
end

function M.on_player_died(e)
  push("player_died", { player = game.get_player(e.player_index).name })
end

function M.on_research_finished(e)
  push("research_finished", { name = e.research.name })
end

function M.on_rocket_launched(_e)
  push("rocket_launched", {})
end

--- Every 3600 ticks: the snapshot op's compact summary as an event.
function M.summary_tick()
  push("snapshot_summary", snapshot.summary())
end

--- The events_since op.
function M.events_since(deps, args)
  if args.seq ~= nil and type(args.seq) ~= "number" then
    error("events_since: seq must be a number")
  end
  if args.limit ~= nil and type(args.limit) ~= "number" then
    error("events_since: limit must be a number")
  end
  local read = ring.read(deps.storage.events, args.seq or 0, args.limit)
  if read.gap then
    return {
      ok = false,
      e = "history_gap",
      m = "requested seq is behind the ring's oldest event",
      r = { oldest_seq = read.oldest_seq },
    }
  end
  return { map_id = deps.map_id(), head_seq = read.head_seq, events = read.events }
end

return M
