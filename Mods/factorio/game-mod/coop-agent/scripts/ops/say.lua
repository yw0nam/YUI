-- The say op: the body speaks one chat line, at most 6 per 60 s.

local WINDOW_TICKS = 3600
local MAX_SENDS = 6
local MAX_CHARS = 200

local M = {}

function M.op(deps, args)
  local text = args.text
  if type(text) ~= "string" or #text == 0 or #text > MAX_CHARS then
    error("say: text must be a string of 1 to " .. MAX_CHARS .. " characters")
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

  game.print(settings.global["coop-agent-body-name"].value .. ": " .. text)
  return {}
end

return M
