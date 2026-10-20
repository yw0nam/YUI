-- The idle_set op: the idle mode and stay position; lifts the stop latch.

local body = require("scripts.body")
local check = require("scripts.jobs.check")
local idle = require("scripts.idle")

local MODES = { follow = true, stay = true }

local M = {}

local function position(pos)
  return type(pos) == "table" and type(pos.x) == "number" and type(pos.y) == "number"
end

function M.op(deps, args)
  if not MODES[args.mode] then
    return check.bad_request("mode: follow or stay expected")
  end
  if args.pos ~= nil and not position(args.pos) then
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
  idle.set(deps, args.mode, pos)
  return {}
end

return M
