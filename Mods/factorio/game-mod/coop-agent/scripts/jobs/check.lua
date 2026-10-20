-- The checks job args and job ops share.

local M = {}

function M.bad_request(message)
  return { ok = false, e = "bad_request", m = message }
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
