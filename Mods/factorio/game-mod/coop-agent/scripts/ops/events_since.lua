-- The events_since op: the events after a seq, or history_gap when the ring forgot them.

local ring = require("scripts.ring")

local M = {}

function M.op(deps, args)
  if args.seq ~= nil and type(args.seq) ~= "number" then
    error("events_since: seq must be a number", 0)
  end
  if args.limit ~= nil and type(args.limit) ~= "number" then
    error("events_since: limit must be a number", 0)
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
  return { map_id = deps.storage.map_id, head_seq = read.head_seq, events = read.events }
end

return M
