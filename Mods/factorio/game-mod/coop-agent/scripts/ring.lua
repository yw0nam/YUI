-- The event ring: the last 2000 events, monotonic seq per map; pure, driven by tests without the game.

local RING_SIZE = 2000
local DEFAULT_LIMIT = 200
local MAX_LIMIT = 200

local M = {}

function M.new()
  return { items = {}, head_seq = 0 }
end

--- Append one event; returns its seq.
function M.push(ring, tick, kind, data)
  ring.head_seq = ring.head_seq + 1
  ring.items[#ring.items + 1] = { seq = ring.head_seq, tick = tick, kind = kind, data = data }
  while #ring.items > RING_SIZE do
    table.remove(ring.items, 1)
  end
  return ring.head_seq
end

--- The oldest `limit` events after since_seq; gap is true when events after since_seq were dropped.
function M.read(ring, since_seq, limit)
  if limit == nil then
    limit = DEFAULT_LIMIT
  end
  limit = math.min(limit, MAX_LIMIT)
  local oldest = ring.items[1] and ring.items[1].seq or nil
  local events = {}
  for _, item in ipairs(ring.items) do
    if item.seq > since_seq then
      if #events >= limit then break end
      events[#events + 1] = item
    end
  end
  return {
    events = events,
    head_seq = ring.head_seq,
    oldest_seq = oldest,
    gap = oldest ~= nil and since_seq < oldest - 1,
  }
end

return M
