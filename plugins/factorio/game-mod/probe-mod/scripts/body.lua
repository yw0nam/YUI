-- The probe body every probe shares: a playerless character, and the helpers that act on it.

local M = {}

function M.make(storage)
  local body = storage.probe.body
  if body and body.valid then
    return body
  end
  local surface = game.surfaces[1]
  local force = game.forces.player
  local spawn = force.get_spawn_position(surface)
  local pos = surface.find_non_colliding_position("character", spawn, 32, 0.5) or spawn
  body = surface.create_entity { name = "character", position = pos, force = force }
  storage.probe.body = body
  return body
end

--- The probe body while it lives; a dead body finishes the probe.
function M.get(state)
  local body = storage.probe.body
  if body and body.valid then
    return body
  end
  if state then
    state.state = "done"
  end
  return nil
end

function M.inventory_count(body, item)
  local inventory = body.get_inventory(defines.inventory.character_main)
  return inventory and inventory.get_item_count(item) or 0
end

--- A free spot for `name` dx tiles east of the body, else that tile.
function M.spot(body, name, dx)
  local near = { x = body.position.x + dx, y = body.position.y }
  return body.surface.find_non_colliding_position(name, near, 8, 1) or near
end

return M
