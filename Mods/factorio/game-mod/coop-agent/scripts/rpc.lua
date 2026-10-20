-- The /coop-rpc framing: pure dispatch over injected deps, one JSON reply per call, capped at 64 KiB.

local host = require("scripts.host")
local store = require("scripts.storage")

local MAX_REPLY_BYTES = 65536
local MEMORY_SIZE = 256

local M = {}

-- write ops replay their stored reply on retry; read ops re-run
M.OPS = {
  status = { fn = require("scripts.ops.status").op },
  snapshot = { fn = require("scripts.ops.snapshot").op },
  find = { fn = require("scripts.ops.find").op },
  inspect = { fn = require("scripts.ops.inspect").op },
  recipe = { fn = require("scripts.ops.recipe").op },
  events_since = { fn = require("scripts.ops.events_since").op },
  jobs = { fn = require("scripts.ops.jobs").op },
  say = { fn = require("scripts.ops.say").op, write = true },
  ping = { fn = require("scripts.ops.ping").op, write = true },
  stop = { fn = require("scripts.ops.stop").op, write = true },
  jobs_enqueue = { fn = require("scripts.ops.jobs_enqueue").op, write = true },
  jobs_cancel = { fn = require("scripts.ops.jobs_cancel").op, write = true },
}

--- The game-facing deps for one dispatch; built per call since game.tick moves.
local function runtime_deps()
  return {
    from_json = helpers.json_to_table,
    to_json = helpers.table_to_json,
    print = rcon.print,
    chat = function(line)
      game.print(line)
    end,
    storage = storage,
    tick = game.tick,
    body_name = settings.global["coop-agent-body-name"].value,
    host = host.get,
    push = store.push,
    draw_text = rendering.draw_text,
    direction = defines.direction,
    item_prototypes = prototypes.item,
    ops = M.OPS,
  }
end

--- The command handler registered in control.lua.
function M.handle(cmd)
  M.dispatch(cmd.parameter, cmd.player_index, runtime_deps())
end

local function first_line(text)
  return tostring(text):match("^[^\n]*")
end

--- djb2 mod 2^31-1 without bitwise operators, so Lua 5.2 and the tests agree.
local function payload_hash(op_name, args_json)
  local hash = 5381
  local text = op_name .. "|" .. args_json
  for i = 1, #text do
    hash = (hash * 33 + string.byte(text, i)) % 2147483647
  end
  return hash
end

local function encode_id(deps, id)
  -- table_to_json takes tables only, so encode {id} and strip the brackets
  return id and string.sub(deps.to_json({ id }), 2, -2) or "null"
end

local function envelope(deps, id, payload)
  local encoded, payload_json = pcall(deps.to_json, payload)
  if not encoded then
    payload_json = deps.to_json({ ok = false, e = "op_error", m = "reply is not plain data: " .. first_line(payload_json) })
  end
  -- the envelope head replaces payload_json's '{' so a nil id prints as null
  return '{"v":1,"id":' .. encode_id(deps, id) .. "," .. string.sub(payload_json, 2)
end

local function finish(deps, id, payload)
  local ok, json = pcall(envelope, deps, id, payload)
  if ok and #json > MAX_REPLY_BYTES then
    local m = "reply is " .. #json .. " bytes, over the " .. MAX_REPLY_BYTES .. "-byte cap"
    ok, json = pcall(envelope, deps, id, { ok = false, e = "too_large", m = m, r = { bytes = #json } })
  end
  if not ok then
    json = '{"v":1,"id":null,"ok":false,"e":"op_error","m":"reply could not be encoded"}'
  end
  deps.print(json)
  return json
end

--- deps: {from_json, to_json, print, chat, storage, tick, body_name, host(), push, draw_text, direction, ops}
function M.dispatch(parameter, player_index, deps)
  local id = nil
  local parsed_ok, req = pcall(deps.from_json, parameter or "")
  if parsed_ok and type(req) == "table" and type(req.id) == "string" then
    id = req.id
  end

  if player_index then
    finish(deps, id, { ok = false, e = "not_console", m = "coop-rpc answers the server console only" })
    return
  end
  if not parsed_ok or type(req) ~= "table" then
    finish(deps, id, { ok = false, e = "bad_request", m = "parameter must be one JSON object" })
    return
  end
  local op_name = req.op
  local op = deps.ops[type(op_name) == "string" and op_name or ""]
  if not op then
    finish(deps, id, { ok = false, e = "unknown_op", m = first_line(op_name) })
    return
  end
  if op_name ~= "status" and req.map_id ~= deps.storage.map_id then
    finish(deps, id, { ok = false, e = "stale_session", m = "map_id does not match this map" })
    return
  end
  local args = type(req.args) == "table" and req.args or {}

  local memory, hash = nil, nil
  if op.write then
    memory = deps.storage.rpc_memory[deps.storage.map_id] or {}
    deps.storage.rpc_memory[deps.storage.map_id] = memory
    hash = payload_hash(op_name, deps.to_json(args))
    for _, entry in ipairs(memory) do
      if entry.id == id then
        if entry.hash == hash then
          deps.print(entry.reply)
        else
          finish(deps, id, { ok = false, e = "id_conflict", m = "id already used with different arguments" })
        end
        return
      end
    end
  end

  local ran_ok, result = pcall(op.fn, deps, args)
  local payload
  if not ran_ok then
    payload = { ok = false, e = "op_error", m = first_line(result) }
  elseif type(result) == "table" and result.ok == false then
    payload = { ok = false, e = result.e, m = result.m, r = result.r }
  else
    payload = { ok = true, r = result }
  end
  local json = finish(deps, id, payload)
  if memory and id then
    memory[#memory + 1] = { id = id, hash = hash, reply = json }
    while #memory > MEMORY_SIZE do
      table.remove(memory, 1)
    end
  end
end

return M
