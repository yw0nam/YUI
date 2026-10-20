-- The number check job args share: nil for a positive number, else what was expected.

local M = {}

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
