-- The idle_set op: the idle mode and stay position; settles the queue and lifts the stop latch.

local body = require("scripts.body")
local check = require("scripts.jobs.check")
local idle = require("scripts.idle")
local jobs = require("scripts.jobs")

local M = {}

local function mode_names()
  local names = {}
  for name in pairs(idle.MODES) do
    names[#names + 1] = name
  end
  table.sort(names)
  return table.concat(names, ", ")
end

local MODE_NAMES = mode_names()

function M.op(deps, args)
  if not idle.MODES[args.mode] then
    return check.bad_request("mode: one of " .. MODE_NAMES .. " expected")
  end
  if args.pos ~= nil and args.mode ~= "stay" then
    return check.bad_request("pos: only the stay mode takes a pos")
  end
  if args.pos ~= nil and not check.position(args.pos) then
    return check.bad_request("pos: {x, y} expected")
  end
  local pos = args.pos
  if args.mode == "stay" and not pos then
    local entity = body.entity(deps)
    if not entity then
      return check.bad_request("pos: a live body or pos expected")
    end
    local at = entity.position
    pos = { x = at.x, y = at.y }
  end
  jobs.settle(deps) -- a stop since the last tick still ends the queue it halted
  idle.set(deps, args.mode, pos)
  return {}
end

return M
