-- The jobs_enqueue op: the one validator of job kinds and args; queues every job of a call or none.

local check = require("scripts.jobs.check")
local jobs = require("scripts.jobs")

local MAX_PER_CALL = 8

local function kind_names()
  local names = {}
  for name in pairs(jobs.KINDS) do
    names[#names + 1] = name
  end
  table.sort(names)
  return table.concat(names, ", ")
end

local KIND_NAMES = kind_names()

local M = {}

--- nil for a valid spec, else "jobs[<zero-based index>].<field>: <what was expected>".
local function invalid(deps, index, spec)
  local at = "jobs[" .. (index - 1) .. "]"
  if type(spec) ~= "table" then
    return at .. ": object expected"
  end
  local kind = jobs.KINDS[spec.kind]
  if not kind then
    return at .. ".kind: one of " .. KIND_NAMES .. " expected"
  end
  if spec.timeout_ticks ~= nil then
    local expected = check.positive(spec.timeout_ticks)
    if expected then
      return at .. ".timeout_ticks: " .. expected
    end
  end
  if type(spec.args) ~= "table" then
    return at .. ".args: object expected"
  end
  local field, expected = kind.validate(spec.args, deps)
  if expected then
    return at .. ".args" .. (field and "." .. field or "") .. ": " .. expected
  end
  return nil
end

function M.op(deps, args)
  local specs = args.jobs
  if type(specs) ~= "table" or #specs < 1 or #specs > MAX_PER_CALL then
    return check.bad_request("jobs: 1 to " .. MAX_PER_CALL .. " jobs expected")
  end
  for index, spec in ipairs(specs) do
    local message = invalid(deps, index, spec)
    if message then
      return check.bad_request(message)
    end
  end
  return jobs.enqueue(deps, specs)
end

return M
