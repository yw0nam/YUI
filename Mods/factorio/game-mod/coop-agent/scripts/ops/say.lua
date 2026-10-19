-- The say op: the body speaks one chat line, at most 6 per 60 s, counted in characters.

local utf8 = require("scripts.utf8")

local WINDOW_TICKS = 3600
local MAX_SENDS = 6
local MAX_CHARS = 200

local M = {}

--- deps.chat prints one chat line; deps.body_name prefixes it.
function M.op(deps, args)
  local text = args.text
  local chars = type(text) == "string" and utf8.len(text) or nil
  if not chars or chars == 0 or chars > MAX_CHARS then
    error("say: text must be 1 to " .. MAX_CHARS .. " characters of valid UTF-8")
  end

  local now = deps.tick
  local recent = {}
  for _, sent_tick in ipairs(deps.storage.say_ticks) do
    if now - sent_tick < WINDOW_TICKS then
      recent[#recent + 1] = sent_tick
    end
  end
  if #recent >= MAX_SENDS then
    return { ok = false, e = "rate_limited", m = "say allows at most 6 messages per 60 s" }
  end
  recent[#recent + 1] = now
  deps.storage.say_ticks = recent

  deps.chat(deps.body_name .. ": " .. text)
  return {}
end

return M
