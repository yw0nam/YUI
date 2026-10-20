-- The storage tables every module shares, and the one push onto the event ring.

local ring = require("scripts.ring")

local M = {}

function M.ensure()
  storage.events = storage.events or ring.new()
  storage.rpc_memory = storage.rpc_memory or {}
  storage.attacks = storage.attacks or {}
  storage.say_ticks = storage.say_ticks or {}
  storage.pings = storage.pings or {}
  storage.unit_index = storage.unit_index or { map = {}, order = {} }
  storage.body = storage.body or { stopped = false, status = "Standing by" }
  storage.jobs = storage.jobs or { next_id = 1, list = {} }
end

function M.push(kind, data)
  ring.push(storage.events, game.tick, kind, data)
end

return M
