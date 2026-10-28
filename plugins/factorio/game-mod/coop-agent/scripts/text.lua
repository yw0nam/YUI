-- The text check say and ping share: a non-empty string of valid UTF-8, at most a number of characters.

local M = {}

local function size_of(byte)
  if byte < 0x80 then return 1 end
  if byte >= 0xC2 and byte <= 0xDF then return 2 end
  if byte >= 0xE0 and byte <= 0xEF then return 3 end
  if byte >= 0xF0 and byte <= 0xF4 then return 4 end
  return nil
end

-- UTF-8 code points in text, or nil when it is not valid UTF-8; Lua 5.2 ships no utf8 library.
local function length(text)
  local count = 0
  local i, n = 1, #text
  while i <= n do
    local size = size_of(string.byte(text, i))
    if size == nil or i + size - 1 > n then
      return nil
    end
    for j = 1, size - 1 do
      local continuation = string.byte(text, i + j)
      if continuation < 0x80 or continuation > 0xBF then
        return nil
      end
    end
    count = count + 1
    i = i + size
  end
  return count
end

--- nil for acceptable text, else the refusal an op returns.
function M.refusal(text, max_chars)
  local chars = type(text) == "string" and length(text) or nil
  if not chars or chars == 0 then
    return { ok = false, e = "bad_request", m = "text must be a non-empty string of valid UTF-8" }
  end
  if chars > max_chars then
    return { ok = false, e = "too_long", m = "text is " .. chars .. " characters, over the " .. max_chars .. "-character limit" }
  end
  return nil
end

return M
