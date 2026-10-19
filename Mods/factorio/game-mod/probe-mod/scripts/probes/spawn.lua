-- The spawn probe: a playerless character at the force spawn. Other probes
-- reuse the body through make_body.

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

local function body_info(storage)
  local body = storage.probe.body
  if not (body and body.valid) then
    return { spawned = false }
  end
  local pos = body.position
  return { spawned = true, unit_number = body.unit_number, position = { x = pos.x, y = pos.y } }
end

function M.start(storage)
  M.make_body(storage)
  return { state = "done" }
end

function M.result(storage)
  local result = body_info(storage)
  result.probe = "spawn"
  result.state = "done"
  return result
end

return M
