-- One id per map, made once on_init from the surface seed and the init tick, kept in storage.

local surface_of = require("scripts.surface")

local M = {}

function M.ensure(storage, tick)
  if not storage.map_id then
    storage.map_id = string.format("%d-%d", surface_of.get().map_gen_settings.seed, tick)
  end
end

return M
