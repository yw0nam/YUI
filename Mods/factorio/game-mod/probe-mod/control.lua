-- Co-op Probe: wiring only.

local dispatch = require("scripts.dispatch")
local driver = require("scripts.driver")

commands.add_command("coop-probe", "Co-op Probe: run one dev probe, JSON out (RCON).", dispatch.handle)

script.on_init(function()
  storage.probe = {}
end)

script.on_nth_tick(1, driver.tick)
