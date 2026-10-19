-- Minimal JSON encoder/decoder standing in for helpers.table_to_json/json_to_table in lupa
-- tests. Handles plain tables (objects and arrays), strings, numbers, booleans. Decoded
-- null becomes nil.
local M = {}

local function escape_char(c)
  if c == '"' then return '\\"' end
  if c == "\\" then return "\\\\" end
  if c == "\n" then return "\\n" end
  if c == "\t" then return "\\t" end
  return string.format("\\u%04x", string.byte(c))
end

local function encode_value(value, out)
  local t = type(value)
  if value == nil then
    out[#out + 1] = "null"
  elseif t == "boolean" then
    out[#out + 1] = tostring(value)
  elseif t == "number" then
    if value % 1 == 0 then
      out[#out + 1] = string.format("%d", value)
    else
      out[#out + 1] = string.format("%.14g", value)
    end
  elseif t == "string" then
    out[#out + 1] = '"' .. value:gsub('[%z\1-\31\\"]', escape_char) .. '"'
  elseif t == "table" then
    local n = 0
    for _ in pairs(value) do n = n + 1 end
    if n == #value then
      out[#out + 1] = "["
      for i, item in ipairs(value) do
        if i > 1 then out[#out + 1] = "," end
        encode_value(item, out)
      end
      out[#out + 1] = "]"
    else
      out[#out + 1] = "{"
      local first = true
      for key, item in pairs(value) do
        if not first then out[#out + 1] = "," end
        first = false
        encode_value(tostring(key), out)
        out[#out + 1] = ":"
        encode_value(item, out)
      end
      out[#out + 1] = "}"
    end
  else
    error("cannot encode value of type " .. t)
  end
end

function M.encode(value)
  local out = {}
  encode_value(value, out)
  return table.concat(out)
end

local function skip_space(text, pos)
  local _, next_pos = text:find("^%s*", pos)
  return next_pos + 1
end

local function decode_value(text, pos)
  pos = skip_space(text, pos)
  local c = text:sub(pos, pos)
  if c == "{" then
    local obj = {}
    pos = skip_space(text, pos + 1)
    if text:sub(pos, pos) == "}" then return obj, pos + 1 end
    while true do
      local key
      key, pos = decode_value(text, pos)
      pos = skip_space(text, pos)
      if text:sub(pos, pos) ~= ":" then error("expected ':' near offset " .. pos) end
      local value
      value, pos = decode_value(text, pos + 1)
      obj[key] = value
      pos = skip_space(text, pos)
      local sep = text:sub(pos, pos)
      if sep == "," then
        pos = pos + 1
      elseif sep == "}" then
        return obj, pos + 1
      else
        error("bad json object near offset " .. pos)
      end
    end
  elseif c == "[" then
    local arr = {}
    pos = skip_space(text, pos + 1)
    if text:sub(pos, pos) == "]" then return arr, pos + 1 end
    while true do
      local value
      value, pos = decode_value(text, pos)
      arr[#arr + 1] = value
      pos = skip_space(text, pos)
      local sep = text:sub(pos, pos)
      if sep == "," then
        pos = pos + 1
      elseif sep == "]" then
        return arr, pos + 1
      else
        error("bad json array near offset " .. pos)
      end
    end
  elseif c == '"' then
    local parts = {}
    pos = pos + 1
    while true do
      local ch = text:sub(pos, pos)
      if ch == '"' then
        return table.concat(parts), pos + 1
      elseif ch == "\\" then
        local esc = text:sub(pos + 1, pos + 1)
        if esc == "n" then
          parts[#parts + 1] = "\n"
        elseif esc == "t" then
          parts[#parts + 1] = "\t"
        elseif esc == '"' or esc == "\\" or esc == "/" then
          parts[#parts + 1] = esc
        else
          error("unsupported escape \\" .. esc)
        end
        pos = pos + 2
      else
        parts[#parts + 1] = ch
        pos = pos + 1
      end
    end
  elseif text:sub(pos, pos + 3) == "null" then
    return nil, pos + 4
  elseif text:sub(pos, pos + 3) == "true" then
    return true, pos + 4
  elseif text:sub(pos, pos + 4) == "false" then
    return false, pos + 5
  else
    local number = text:match("^-?%d+%.?%d*[eE]?[+-]?%d*", pos)
    if number then return tonumber(number), pos + #number end
    error("bad json near offset " .. pos)
  end
end

function M.decode(text)
  local value = decode_value(text, 1)
  return value
end

return M
