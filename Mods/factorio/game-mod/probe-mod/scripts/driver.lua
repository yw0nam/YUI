-- The per-tick driver: advances every running probe.

local probes = require("scripts.probes")

local M = {}

function M.tick()
  for name, probe in pairs(probes) do
    local state = storage.probe[name]
    if state and state.state == "running" then
      probe.tick(storage)
    end
  end
end

return M
