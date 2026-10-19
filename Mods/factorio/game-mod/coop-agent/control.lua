-- Co-op Agent - control.lua
--
-- Wiring only: requires the modules and registers the command, the event
-- handlers and the nth-tick handlers at the root, once per Lua state.

local ring = require("scripts.ring")
local rpc = require("scripts.rpc")
local events = require("scripts.events")
local attack = require("scripts.attack")
local map_id = require("scripts.map_id")
local ping = require("scripts.ops.ping")

commands.add_command("coop-rpc", "Co-op Agent: one JSON request in, one JSON reply out (RCON).", rpc.handle)

local function ensure_storage()
  storage.events = storage.events or ring.new()
  storage.rpc_memory = storage.rpc_memory or {}
  storage.attacks = storage.attacks or {}
  storage.say_ticks = storage.say_ticks or {}
  storage.pings = storage.pings or {}
  storage.unit_index = storage.unit_index or {}
end

script.on_init(function()
  ensure_storage()
  map_id.ensure(storage, game.tick)
end)

script.on_configuration_changed(ensure_storage)

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
