-- The recipe op: a recipe prototype's parts plus every machine that can craft it.

local M = {}

local function part(p)
  return {
    name = p.name,
    type = p.type,
    amount = p.amount,
    amount_min = p.amount_min,
    amount_max = p.amount_max,
    probability = p.probability,
  }
end

function M.op(_deps, args)
  local name = args.name
  if type(name) ~= "string" then
    error("recipe: name must be a string", 0)
  end
  local proto = prototypes.recipe[name]
  if not proto then
    error("recipe: no recipe named " .. name, 0)
  end

  local ingredients, products = {}, {}
  for i, ingredient in ipairs(proto.ingredients) do
    ingredients[i] = part(ingredient)
  end
  for i, product in ipairs(proto.products) do
    products[i] = part(product)
  end

  local machines = {}
  for machine_name, proto_machine in pairs(prototypes.entity) do
    local categories = proto_machine.crafting_categories
    if categories and categories[proto.category] then
      machines[#machines + 1] = { name = machine_name, crafting_speed = proto_machine.get_crafting_speed() }
    end
  end
  table.sort(machines, function(a, b)
    return a.name < b.name
  end)

  return {
    name = name,
    category = proto.category,
    energy = proto.energy,
    ingredients = ingredients,
    products = products,
    machines = machines,
  }
end

return M
