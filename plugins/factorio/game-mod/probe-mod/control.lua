-- Co-op Probe: wiring only.

local dev_host = require("scripts.dev_host")
local dispatch = require("scripts.dispatch")
local driver = require("scripts.driver")

remote.add_interface("coop-agent-dev", dev_host.interface)
commands.add_command("coop-probe", "Co-op Probe: run one dev probe, JSON out (RCON).", dispatch.handle)

script.on_init(function()
  storage.probe = {}
end)

script.on_nth_tick(1, driver.tick)
