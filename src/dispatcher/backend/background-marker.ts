/** Placeholder user-content text a turn with no real user utterance carries into the backend prompt. */

import type { TriggerMeta } from "../../contract";

/** "a" / "a and b" / "a, b and c". */
function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Interpolated into the user turn, so a hostile hook payload can't forge structure: the ingress
 * is unauthenticated and caps `summary`/`detail` but not `tool`. Collapsing whitespace keeps the
 * marker one line and the clamp keeps it a name. `trigger.agent.tool` still carries it verbatim.
 */
const TOOL_NAME_MAX = 40;
const toolName = (raw: string): string => raw.replace(/\s+/g, " ").trim().slice(0, TOOL_NAME_MAX);

/**
 * User message for non-user turns (no user_text) — a short, per-trigger notice. Delivered in a
 * role: "user" message, so it is written from the user's POV: "I" is the user, "you" is the
 * agent. Describes what happened, never how to respond (firing ≠ judgment). The only payload
 * interpolation is the coding-agent tool name on `agent.*` turns, which falls back to unnamed
 * wording when validation rejected the payload and the trigger field is absent.
 */
export function backgroundMarker(eventName: string, trigger: TriggerMeta): string {
  if (eventName === "proactive.tap_bored") return "(I keep poking at you)";
  if (eventName.startsWith("proactive.touch_")) return "(I just poked you)";
  if (eventName === "proactive.head_pat") return "(I just patted your head)";
  if (eventName === "proactive.drag_held") return "(I keep dragging you around)";
  if (eventName === "proactive.window_sit") return "(I just sat you down on a window's edge)";
  if (eventName === "proactive.peek") return "(I left you peeking out from the screen edge)";
  if (eventName === "proactive.dropped") return "(I just dropped you from mid-air)";
  if (eventName === "proactive.screen_app_switched") {
    return "(I just moved over to something else on my screen)";
  }
  if (eventName === "proactive.screen_long_session") {
    return "(I've been in the same thing on my screen for a while)";
  }
  if (eventName.startsWith("proactive.")) return "(I've gone quiet for a while)";
  if (eventName.startsWith("schedule.")) return "(it's the time of day you check in on me)";
  if (eventName === "agent.done" || eventName === "agent.needs_input") {
    const tool = trigger.agent ? toolName(trigger.agent.tool) : "";
    const subject = tool ? `my ${tool} task` : "one of my coding tasks";
    return eventName === "agent.done"
      ? `(${subject} just finished)`
      : `(${subject} is waiting on my input)`;
  }
  if (eventName === "agent.catchup") {
    const named = trigger.agent_catchup?.items.map((item) => toolName(item.tool)).filter(Boolean);
    const tools = [...new Set(named ?? [])];
    const subject = tools.length ? `my ${joinNames(tools)} tasks` : "my coding tasks";
    return `(${subject} piled up while I was away)`;
  }
  if (eventName === "signals.push") return "(a new signal just arrived for you)";
  if (eventName === "signals.batch") return "(a few signals batched up for you)";
  if (eventName === "signals.catchup") return "(signals piled up while I was away)";
  if (eventName === "time_milestone.first_activity") return "(I've just started my day)";
  return "(something just caught your attention)";
}
