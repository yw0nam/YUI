-- One id per map, made once on_init from the map seed plus the init tick, kept in storage.

local surface_of = require("scripts.surface")

local M = {}

function M.ensure(storage, tick)
  if not storage.map_id then
    local map_seed = surface_of.get().map_gen_settings.seed
    local rng = game.create_random_generator((map_seed + tick) % 4294967295)
    storage.map_id = string.format("%d-%d", tick, math.floor(rng() * 2147483647))
  end
end

return M
