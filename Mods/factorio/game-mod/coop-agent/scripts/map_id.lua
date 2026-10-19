-- One id per map, made once on_init and kept in storage, so a save reload of
-- the same map carries the id and a fresh map gets a fresh one. The generator
-- is seeded from the map's own seed plus the init tick, so every peer that
-- runs this at the same tick stores the same string.

local M = {}

function M.ensure(storage, tick)
  if not storage.map_id then
    local surface = game.get_surface("nauvis")
    local map_seed = surface and surface.valid and surface.map_gen_settings.seed or 0
    local rng = game.create_random_generator((map_seed + tick) % 4294967295)
    storage.map_id = string.format("%d-%d", tick, math.floor(rng() * 2147483647))
  end
  return storage.map_id
end

return M
