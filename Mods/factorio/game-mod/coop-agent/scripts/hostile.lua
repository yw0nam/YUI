-- Whose damage counts as hostile: the event's force, else its still-valid cause's force, when the player force is_enemy with it.

local M = {}

--- The force of a damage or death event's cause while the cause is still valid, else nil.
function M.cause_force(e)
  return e.cause and e.cause.valid and e.cause.force or nil
end

--- True when the attacker, the event's force or else the cause's force, is a force player_force is_enemy with.
function M.is_enemy(player_force, attacker_force, cause_force)
  local attacker = attacker_force or cause_force
  return attacker ~= nil and player_force.is_enemy(attacker)
end

return M
