-- Co-op Agent: wiring only.

local rpc = require("scripts.rpc")
local events = require("scripts.events")
local attack = require("scripts.attack")
local store = require("scripts.storage")
local map_id = require("scripts.map_id")
local ping = require("scripts.ops.ping")

commands.add_command("coop-rpc", "Co-op Agent: one JSON request in, one JSON reply out (RCON).", rpc.handle)

script.on_init(function()
  store.ensure()
  map_id.ensure(storage, game.tick)
end)

script.on_configuration_changed(store.ensure)

script.on_event(defines.events.on_console_chat, events.on_console_chat)
script.on_event(defines.events.on_player_joined_game, events.on_player_joined)
script.on_event(defines.events.on_player_left_game, events.on_player_left)
script.on_event(defines.events.on_player_died, events.on_player_died)
script.on_event(defines.events.on_research_finished, events.on_research_finished)
script.on_event(defines.events.on_rocket_launched, events.on_rocket_launched)
script.on_event(defines.events.on_entity_damaged, attack.on_damaged_event)
script.on_event(defines.events.on_entity_died, attack.on_died_event)

script.on_nth_tick(60, attack.sweep_tick)
script.on_nth_tick(600, ping.sweep_tick)
script.on_nth_tick(3600, events.summary_tick)
