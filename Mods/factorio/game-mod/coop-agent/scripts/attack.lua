-- Attack grouping: hostile damage on a 64-tile cell opens one attack, 600 quiet ticks close it.

local store = require("scripts.storage")

local CELL_TILES = 64
local QUIET_TICKS = 600

local M = {}

local function cell_of(surface_name, pos)
  return {
    surface = surface_name,
    x = math.floor(pos.x / CELL_TILES) * CELL_TILES,
    y = math.floor(pos.y / CELL_TILES) * CELL_TILES,
  }
end

local function key(cell)
  return cell.surface .. ";" .. cell.x .. ";" .. cell.y
end

--- deps: {storage, tick, count_cell(surface, cell) -> {enemies, defenders}, push(kind, data)}
function M.on_damaged(deps, ev)
  local attacks = deps.storage.attacks
  local cell = cell_of(ev.surface, ev.position)
  local open = attacks[key(cell)]
  if open then
    open.last_tick = deps.tick
    return
  end
  local counts = deps.count_cell(cell.surface, cell)
  attacks[key(cell)] = { cell = cell, opened_tick = deps.tick, last_tick = deps.tick, losses = {} }
  deps.push("attack_started", { cell = cell, enemies = counts.enemies, defenders = counts.defenders })
end

--- Deaths only count towards a cell that has an open attack.
function M.on_died(deps, ev)
  local cell = cell_of(ev.surface, ev.position)
  local open = deps.storage.attacks[key(cell)]
  if open then
    open.losses[ev.name] = (open.losses[ev.name] or 0) + 1
  end
end

--- Close every cell quiet for QUIET_TICKS; losses leave sorted by name.
function M.sweep(deps, now)
  for key, open in pairs(deps.storage.attacks) do
    if now - open.last_tick >= QUIET_TICKS then
      local losses = {}
      for name, count in pairs(open.losses) do
        losses[#losses + 1] = { name = name, count = count }
      end
      table.sort(losses, function(a, b)
        return a.name < b.name
      end)
      deps.push("attack_ended", { cell = open.cell, duration_s = (now - open.opened_tick) / 60, losses = losses })
      deps.storage.attacks[key] = nil
    end
  end
end

local function hostile(player_force, force)
  return force ~= player_force and force.name ~= "neutral" and not player_force.get_friend(force)
end

local function production_deps()
  return {
    storage = storage,
    tick = game.tick,
    count_cell = function(surface_name, cell)
      local surface = game.get_surface(surface_name)
      if not (surface and surface.valid) then
        return { enemies = 0, defenders = 0 }
      end
      local player_force = game.forces.player
      local enemies, defenders = 0, 0
      for _, entity in ipairs(surface.find_entities_filtered {
        area = {
          left_top = { x = cell.x, y = cell.y },
          right_bottom = { x = cell.x + CELL_TILES, y = cell.y + CELL_TILES },
        },
      }) do
        if entity.valid and entity.force then
          if entity.force == player_force then
            defenders = defenders + 1
          elseif hostile(player_force, entity.force) then
            enemies = enemies + 1
          end
        end
      end
      return { enemies = enemies, defenders = defenders }
    end,
    push = store.push,
  }
end

local function defender_damage(e)
  local entity, cause = e.entity, e.cause
  if not (entity and entity.valid and cause and cause.valid) then
    return false
  end
  local player_force = game.forces.player
  return entity.force == player_force and hostile(player_force, cause.force)
end

function M.on_damaged_event(e)
  if defender_damage(e) then
    M.on_damaged(production_deps(), { surface = e.entity.surface.name, position = e.entity.position })
  end
end

function M.on_died_event(e)
  local entity = e.entity
  if entity.valid then
    M.on_died(production_deps(), { surface = entity.surface.name, position = entity.position, name = entity.name })
  end
end

function M.sweep_tick()
  M.sweep(production_deps(), game.tick)
end

return M
