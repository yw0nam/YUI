-- One id per map, made once on_init from the map seed plus the init tick, kept in storage.

local M = {}

function M.ensure(storage, tick)
  if not storage.map_id then
    local surface = game.get_surface("nauvis")
    local map_seed = surface and surface.map_gen_settings.seed or 0
    local rng = game.create_random_generator((map_seed + tick) % 4294967295)
    storage.map_id = string.format("%d-%d", tick, math.floor(rng() * 2147483647))
  end
end

return M
