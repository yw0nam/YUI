-- The status line above the body: "<name> · <state>", drawn once and rewritten only when its text changes.

local WHITE = { r = 1, g = 1, b = 1 }

local M = {}

--- view: {status, stopped?, waiting_for?, ack?}; the chat acknowledgement outranks the stop latch, the latch outranks waiting.
function M.text(name, view)
  local state = view.status
  if view.ack then
    state = "…"
  elseif view.stopped then
    state = "Stopped"
  elseif view.waiting_for then
    state = "Waiting for " .. view.waiting_for
  end
  return name .. " · " .. state
end

--- holder keeps the LuaRenderObject in storage as holder.label.
function M.show(entity, holder, text)
  local label = holder.label
  if label and label.valid then
    if label.text ~= text then
      label.text = text
    end
    return
  end
  holder.label = rendering.draw_text {
    text = text,
    surface = entity.surface,
    target = { entity = entity, offset = { 0, -2.5 } },
    color = WHITE,
    alignment = "center",
    scale = 1.2,
  }
end

return M
