/** Placeholder user-content text a turn with no real user utterance carries into the backend prompt. */

import type { TriggerMeta } from "../../contract";
import { ADDRESSED_EVENT } from "../core/classify";

/**
 * Interpolated into the user turn, so a hostile name can't forge structure. Collapsing whitespace
 * keeps the marker one line and the clamp keeps it a name; `trigger.addressed.from` still carries
 * it verbatim.
 */
const NAME_MAX = 40;
const speakerName = (raw: string): string => raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

/**
 * User message for non-user turns (no user_text) — a short, per-trigger notice. Delivered in a
 * role: "user" message, so it is written from the user's POV: "I" is the user, "you" is the
 * agent. Describes what happened, never how to respond (firing ≠ judgment). The only payload
 * interpolation is the speaking character's name on an addressed turn.
 */
export function backgroundMarker(eventName: string, trigger: TriggerMeta): string {
  if (eventName === "proactive.tap_bored") return "(I keep poking at you)";
  if (eventName.startsWith("proactive.touch_")) return "(I just poked you)";
  if (eventName === "proactive.head_pat") return "(I just patted your head)";
  if (eventName === "proactive.drag_held") return "(I keep dragging you around)";
  if (eventName === "proactive.window_sit") return "(I just sat you down on a window's edge)";
  if (eventName === "proactive.peek") return "(I left you peeking out from the side of a window)";
  if (eventName === "proactive.dropped") return "(I just dropped you from mid-air)";
  if (eventName === "proactive.screen_app_switched") {
    return "(I just moved over to something else on my screen)";
  }
  if (eventName === "proactive.screen_long_session") {
    return "(I've been in the same thing on my screen for a while)";
  }
  if (eventName === "proactive.wake") {
    return trigger.wake?.cause === "timeout" ? "(you just woke up)" : "(I just woke you up)";
  }
  if (eventName.startsWith("proactive.")) return "(I've gone quiet for a while)";
  if (eventName.startsWith("schedule.")) return "(it's the time of day you check in on me)";
  if (eventName === "signals.push") return "(a new signal just arrived for you)";
  if (eventName === "signals.batch") return "(a few signals batched up for you)";
  if (eventName === "signals.catchup") return "(signals piled up for you)";
  if (eventName === "signals.urgent") return "(something urgent just came in for you)";
  if (eventName === "signals.urgent_catchup") return "(urgent things piled up for you)";
  if (eventName === ADDRESSED_EVENT && trigger.addressed) {
    return `(${speakerName(trigger.addressed.from)} just spoke to you)`;
  }
  if (eventName === "time_milestone.first_activity") return "(I've just started my day)";
  return "(something just caught your attention)";
}
