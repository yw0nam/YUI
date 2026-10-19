-- The spawn probe: a playerless character at the force spawn, and the body helpers every probe shares.

local M = {}

function M.make_body(storage)
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
function M.body(state)
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

function M.result(storage)
  local body = storage.probe.body
  local result = { probe = "spawn", state = "done", spawned = body ~= nil and body.valid }
  if body and body.valid then
    local pos = body.position
    result.unit_number = body.unit_number
    result.position = { x = pos.x, y = pos.y }
  end
  return result
end

function M.start(storage)
  M.make_body(storage)
  return { state = "done" }
end

return M
