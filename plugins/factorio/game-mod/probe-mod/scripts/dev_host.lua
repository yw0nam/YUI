-- The dev host: a fake host position coop-agent reads through the coop-agent-dev remote interface.

local M = {}

M.interface = {
  host_position = function()
    return storage.probe.host
  end,
  set_host_position = function(x, y)
    storage.probe.host = { x = x, y = y }
  end,
}

--- "<x> <y>" from /coop-probe host; returns the reply.
function M.command(rest)
  local x, y = rest:match("^(%S+)%s+(%S+)$")
  x, y = tonumber(x), tonumber(y)
  if not (x and y) then
    return { ok = false, e = "bad_request", m = "usage: /coop-probe host <x> <y>" }
  end
  M.interface.set_host_position(x, y)
  return { ok = true, host = storage.probe.host }
end

return M
