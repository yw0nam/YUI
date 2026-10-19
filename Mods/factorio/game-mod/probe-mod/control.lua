-- Co-op Probe - control.lua
--
-- Wiring: the /coop-probe command plus a per-tick driver for multi-tick
-- probes. A probe starts on the first call and reports its JSON result on
-- every call; when done, the result prints and the probe state clears, so the
-- next call re-runs it. Poll a running probe until state == "done".

local probes = {
  spawn = require("scripts.probes.spawn"),
  mining = require("scripts.probes.mining"),
  crafting = require("scripts.probes.crafting"),
  baseline = require("scripts.probes.baseline"),
  revive = require("scripts.probes.revive"),
  spill = require("scripts.probes.spill"),
}

local function probe_names()
  local names = {}
  for name in pairs(probes) do
    names[#names + 1] = name
  end
  table.sort(names)
  return table.concat(names, ", ")
end

commands.add_command("coop-probe", "Co-op Probe: run one dev probe, JSON out (RCON).", function(cmd)
  if cmd.player_index then
    rcon.print('{"ok":false,"e":"not_console"}')
    return
  end
  local name = cmd.parameter and cmd.parameter:match("^%s*(.-)%s*$") or ""
  local probe = probes[name]
  if not probe then
    rcon.print(helpers.table_to_json({ ok = false, e = "unknown_probe", m = "probes: " .. probe_names() }))
    return
  end

  local state = storage.probe[name]
  if not state then
    state = probe.start(storage) or { state = "done" }
    storage.probe[name] = state
  end
  local result = probe.result(storage)
  if state.state == "done" then
    storage.probe[name] = nil
  end
  rcon.print(helpers.table_to_json(result))
end)

script.on_init(function()
  storage.probe = { body = nil }
end)

script.on_nth_tick(1, function()
  for name, probe in pairs(probes) do
    local state = storage.probe[name]
    if state and state.state == "running" then
      probe.tick(storage)
    end
  end
end)
