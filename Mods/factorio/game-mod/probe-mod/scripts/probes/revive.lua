-- The revive probe: revive{raise_revive=true} on a wooden-chest ghost while the body holds a chest.

local spawn = require("scripts.probes.spawn")

local M = {}

function M.start(storage)
  local body = spawn.make_body(storage)
  local inventory = body.get_inventory(defines.inventory.character_main)
  inventory.insert { name = "wooden-chest", count = 1 }
  local before = inventory.get_item_count("wooden-chest")

  local pos = body.position
  local place = body.surface.find_non_colliding_position("wooden-chest", { x = pos.x + 2, y = pos.y }, 8, 1)
    or { x = pos.x + 2, y = pos.y }
  local ghost = body.surface.create_entity {
    name = "entity-ghost",
    inner_name = "wooden-chest",
    position = place,
    force = "player",
    expires = false,
  }
  if not (ghost and ghost.valid) then
    return { state = "done", error = "could not place the wooden-chest ghost" }
  end

  local collided, revived = ghost.revive { raise_revive = true }
  local after = inventory.get_item_count("wooden-chest")
  local collisions
  if collided then
    collisions = {}
    for _, stack in ipairs(collided) do
      collisions[#collisions + 1] = { name = stack.name, count = stack.count }
    end
  end
  return {
    state = "done",
    inventory_before = before,
    inventory_after = after,
    item_consumed = before - after,
    revive_returned_entity = revived and revived.valid
        and { name = revived.name, unit_number = revived.unit_number }
      or nil,
    revive_returned_collisions = collisions,
  }
end

function M.result(storage)
  local state = storage.probe.revive
  state.result = state.result or {
    probe = "revive",
    state = state.state,
    inventory_before = state.inventory_before,
    inventory_after = state.inventory_after,
    item_consumed = state.item_consumed,
    revive_returned_entity = state.revive_returned_entity,
    revive_returned_collisions = state.revive_returned_collisions,
    error = state.error,
  }
  return state.result
end

return M
