-- The /coop-rpc framing. `dispatch` is pure: every game touch (helpers JSON,
-- rcon.print, storage, game.tick, the ops table) arrives through `deps`, so
-- tests drive it without the game. Exactly one `deps.print` per call, always
-- {"v":1,"id":...} + the payload; replies over 65536 bytes are replaced with
-- e:"too_large".

local MAX_REPLY_BYTES = 65536
local MEMORY_SIZE = 256

local OPS = {
  status = require("scripts.ops.status").op,
  snapshot = require("scripts.ops.snapshot").op,
  find = require("scripts.ops.find").op,
  inspect = require("scripts.ops.inspect").op,
  recipe = require("scripts.ops.recipe").op,
  say = require("scripts.ops.say").op,
  ping = require("scripts.ops.ping").op,
  events_since = require("scripts.events").events_since,
}

local M = {}

--- The game-facing deps for one dispatch; built per call since game.tick moves.
local function runtime_deps()
  return {
    from_json = helpers.json_to_table,
    to_json = helpers.table_to_json,
    print = rcon.print,
    storage = storage,
    tick = game.tick,
    map_id = function()
      return storage.map_id
    end,
    ops = OPS,
  }
end

--- The command handler registered in control.lua.
function M.handle(cmd)
  M.dispatch(cmd.parameter, cmd.player_index, runtime_deps())
end

local function first_line(text)
  return tostring(text):match("^[^\n]*")
end

--- Cheap deterministic string hash (djb2 mod 2^31-1). Written without bitwise
--- operators so it behaves identically on every Lua the game or the tests run.
local function payload_hash(op_name, args_json)
  local hash = 5381
  local text = op_name .. "|" .. args_json
  for i = 1, #text do
    hash = (hash * 33 + string.byte(text, i)) % 2147483647
  end
  return hash
end

local function encode_id(deps, id)
  -- table_to_json takes tables only; encode {id} and strip the array brackets
  return id and string.sub(deps.to_json({ id }), 2, -2) or "null"
end

local function envelope(deps, id, payload)
  local encoded, payload_json = pcall(deps.to_json, payload)
  if not encoded then
    payload_json = deps.to_json({ ok = false, e = "op_error", m = "reply is not plain data: " .. first_line(payload_json) })
  end
  -- payload_json starts with '{'; the envelope head replaces it so a nil id
  -- still prints as an explicit null.
  return '{"v":1,"id":' .. encode_id(deps, id) .. "," .. string.sub(payload_json, 2)
end

local function finish(deps, id, payload)
  local ok, json = pcall(envelope, deps, id, payload)
  if ok and #json > MAX_REPLY_BYTES then
    ok, json = pcall(envelope, deps, id, { ok = false, e = "too_large", r = { bytes = #json } })
  end
  if not ok then
    json = '{"v":1,"id":null,"ok":false,"e":"op_error","m":"reply could not be encoded"}'
  end
  deps.print(json)
  return json
end

local function op_error(payload)
  -- An op answers a protocol-level refusal by returning this shape.
  return { ok = false, e = payload.e, m = payload.m, r = payload.r }
end

--- deps: {from_json, to_json, print, storage, tick, map_id = fn, ops}
function M.dispatch(parameter, player_index, deps)
  local id = nil
  local parsed_ok, req = pcall(deps.from_json, parameter or "")
  if parsed_ok and type(req) == "table" and type(req.id) == "string" then
    id = req.id
  end

  if player_index then
    finish(deps, id, { ok = false, e = "not_console" })
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
  if op_name ~= "status" and req.map_id ~= deps.map_id() then
    finish(deps, id, { ok = false, e = "stale_session", m = "map_id does not match this map" })
    return
  end
  local args = type(req.args) == "table" and req.args or {}

  local map_key = req.map_id or deps.map_id()
  local memory = deps.storage.rpc_memory[map_key]
  if not memory then
    memory = {}
    deps.storage.rpc_memory[map_key] = memory
  end
  local hash = payload_hash(op_name, deps.to_json(args))
  if id then
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

  local ran_ok, result = pcall(op, deps, args)
  local payload
  if not ran_ok then
    payload = { ok = false, e = "op_error", m = first_line(result) }
  elseif type(result) == "table" and result.ok == false then
    payload = op_error(result)
  else
    payload = { ok = true, r = result }
  end
  local json = finish(deps, id, payload)
  if ran_ok and payload.ok and id then
    memory[#memory + 1] = { id = id, hash = hash, reply = json }
    while #memory > MEMORY_SIZE do
      table.remove(memory, 1)
    end
  end
end

return M
