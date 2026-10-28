-- Attack grouping: hostile damage on a 64-tile cell opens one attack, 600 quiet ticks close it.

local hostile = require("scripts.hostile")
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

local function defender_hit(player_force, ev)
  return ev.entity_force == player_force and hostile.is_enemy(player_force, ev.attacker_force, ev.cause_force)
end

--- deps: {storage, tick, player_force, count_cell(cell), push(kind, data)}
function M.on_damaged(deps, ev)
  if not defender_hit(deps.player_force, ev) then
    return
  end
  local cell = cell_of(ev.surface, ev.position)
  local open = deps.storage.attacks[key(cell)]
  if open then
    open.last_tick = deps.tick
    return
  end
  local counts = deps.count_cell(cell)
  deps.storage.attacks[key(cell)] = { cell = cell, opened_tick = deps.tick, last_tick = deps.tick, losses = {} }
  deps.push("attack_started", { cell = cell, enemies = counts.enemies, defenders = counts.defenders })
end

function M.on_died(deps, ev)
  local open = deps.storage.attacks[key(cell_of(ev.surface, ev.position))]
  if open and defender_hit(deps.player_force, ev) then
    open.losses[ev.name] = (open.losses[ev.name] or 0) + 1
  end
end

function M.sweep(deps, now)
  for cell_key, open in pairs(deps.storage.attacks) do
    if now - open.last_tick >= QUIET_TICKS then
      local losses = {}
      for name, count in pairs(open.losses) do
        losses[#losses + 1] = { name = name, count = count }
      end
      table.sort(losses, function(a, b)
        return a.name < b.name
      end)
      deps.push("attack_ended", { cell = open.cell, duration_s = (now - open.opened_tick) / 60, losses = losses })
      deps.storage.attacks[cell_key] = nil
    end
  end
end

local function count_cell(cell)
  local surface = game.get_surface(cell.surface)
  if not surface then
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
    if entity.force == player_force then
      defenders = defenders + 1
    elseif player_force.is_enemy(entity.force) then
      enemies = enemies + 1
    end
  end
  return { enemies = enemies, defenders = defenders }
end

local function game_deps()
  return {
    storage = storage,
    tick = game.tick,
    player_force = game.forces.player,
    count_cell = count_cell,
    push = store.push,
  }
end

local function hit_of(e)
  local entity = e.entity
  if not entity.valid then
    return nil
  end
  return {
    surface = entity.surface.name,
    position = entity.position,
    name = entity.name,
    entity_force = entity.force,
    attacker_force = e.force,
    cause_force = hostile.cause_force(e),
  }
end

function M.on_damaged_event(e)
  local hit = hit_of(e)
  if hit then
    M.on_damaged(game_deps(), hit)
  end
end

function M.on_died_event(e)
  local hit = hit_of(e)
  if hit then
    M.on_died(game_deps(), hit)
  end
end

function M.sweep_tick()
  M.sweep(game_deps(), game.tick)
end

return M
