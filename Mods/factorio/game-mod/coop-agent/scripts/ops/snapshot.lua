-- The snapshot op and its compact summary form.

local surface_of = require("scripts.surface")

local SCIENCE_PACKS = {
  "automation-science-pack",
  "logistic-science-pack",
  "military-science-pack",
  "chemical-science-pack",
  "production-science-pack",
  "utility-science-pack",
  "space-science-pack",
}

local M = {}

local function flow_sum(stats, category, precision)
  local counts = category == "output" and stats.output_counts or stats.input_counts
  local total = 0
  for name in pairs(counts) do
    total = total + stats.get_flow_count { name = name, category = category, precision_index = precision }
  end
  return total
end

local function electric_networks(surface, precision)
  local seen = {}
  local networks = {}
  for _, pole in ipairs(surface.find_entities_filtered { type = "electric-pole" }) do
    local id = pole.electric_network_id
    if pole.valid and id and not seen[id] then
      seen[id] = true
      local stats = pole.electric_network_statistics
      networks[#networks + 1] = {
        id = id,
        production = flow_sum(stats, "output", precision),
        consumption = flow_sum(stats, "input", precision),
      }
    end
  end
  table.sort(networks, function(a, b)
    return a.id < b.id
  end)
  return networks
end

local function science(force, surface, precision)
  local stats = force.get_item_production_statistics(surface)
  local packs = {}
  local total = 0
  for _, pack in ipairs(SCIENCE_PACKS) do
    local rate = stats.get_flow_count { name = pack, category = "output", precision_index = precision }
    if rate ~= 0 then
      packs[pack] = rate
    end
    total = total + rate
  end
  return { total = total, packs = packs }
end

local function research(force)
  local current = force.current_research
  local queue = {}
  for _, technology in ipairs(force.research_queue) do
    queue[#queue + 1] = technology.name
  end
  return {
    current = current and { name = current.name, progress = force.research_progress } or nil,
    queue = queue,
  }
end

local function evolution(surface)
  local enemy = game.forces.enemy
  return enemy and enemy.get_evolution_factor(surface) or 0
end

function M.summary()
  local surface = surface_of.get()
  local force = game.forces.player
  local precision = defines.flow_precision_index.one_minute
  local production, consumption = 0, 0
  for _, network in ipairs(electric_networks(surface, precision)) do
    production = production + network.production
    consumption = consumption + network.consumption
  end
  return {
    power = { production = production, consumption = consumption },
    science = science(force, surface, precision).total,
    evolution = evolution(surface),
    pollution = surface.get_total_pollution(),
  }
end

function M.op(_deps, args)
  local wanted = {}
  if type(args.sections) == "table" then
    for _, section in ipairs(args.sections) do
      wanted[section] = true
    end
  end
  local function wanted_section(name)
    return next(wanted) == nil or wanted[name]
  end

  local surface = surface_of.get()
  local force = game.forces.player
  local out = {}
  if wanted_section("power") then
    out.power = electric_networks(surface, defines.flow_precision_index.one_minute)
  end
  if wanted_section("science") then
    out.science = {
      last_1m = science(force, surface, defines.flow_precision_index.one_minute),
      last_10m = science(force, surface, defines.flow_precision_index.ten_minutes),
    }
  end
  if wanted_section("research") then
    out.research = research(force)
  end
  if wanted_section("evolution") then
    out.evolution = evolution(surface)
  end
  if wanted_section("pollution") then
    out.pollution = surface.get_total_pollution()
  end
  return out
end

return M
