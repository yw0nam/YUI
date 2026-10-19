-- UTF-8 code point count for Lua 5.2, which ships no utf8 library; nil when the text is not valid UTF-8.

local M = {}

local function size_of(byte)
  if byte < 0x80 then return 1 end
  if byte >= 0xC2 and byte <= 0xDF then return 2 end
  if byte >= 0xE0 and byte <= 0xEF then return 3 end
  if byte >= 0xF0 and byte <= 0xF4 then return 4 end
  return nil
end

function M.len(text)
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

return M
