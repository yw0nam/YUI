-- The checks job args and job ops share.

local M = {}

local MAX_COUNT = 1000

function M.bad_request(message)
  return { ok = false, e = "bad_request", m = message }
end

--- nil for an integer 1 to MAX_COUNT, else what was expected.
function M.count(value)
  if type(value) ~= "number" or value ~= math.floor(value) or value < 1 or value > MAX_COUNT then
    return "integer 1 to " .. MAX_COUNT .. " expected"
  end
  return nil
end

--- nil for a positive number, else what was expected.
function M.positive(value)
  if type(value) ~= "number" then
    return "number expected"
  end
  if value <= 0 then
    return "positive number expected"
  end
  return nil
end

return M
