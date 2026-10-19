-- The /coop-probe command handler: start, report, clear when done.

local probes = require("scripts.probes")

local M = {}

local function names()
  local list = {}
  for name in pairs(probes) do
    list[#list + 1] = name
  end
  table.sort(list)
  return table.concat(list, ", ")
end

function M.handle(cmd)
  if cmd.player_index then
    rcon.print('{"ok":false,"e":"not_console"}')
    return
  end
  local name = cmd.parameter and cmd.parameter:match("^%s*(.-)%s*$") or ""
  local probe = probes[name]
  if not probe then
    rcon.print(helpers.table_to_json({ ok = false, e = "unknown_probe", m = "probes: " .. names() }))
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
end

return M
