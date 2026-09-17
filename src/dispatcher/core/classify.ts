/** Pure classification of a bus envelope into tier and target, plus the paced-source table. */
import type { BusEnvelope } from "./event-bus";

export type Tier = 1 | 2 | 3;
export type Target = "tier1" | "backend_caller" | "drop";

export interface Classification {
  tier: Tier;
  target: Target;
}

/**
 * classify. Only handled events are routed; the rest are dropped (= no-op).
 * Tap reactions are handled as tier1 local events.
 */
export function classify(env: BusEnvelope): Classification {
  const n = env.event_name;
  if (n === "user.text_submitted" || n === "user.voice_segment_ready") {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("time_milestone.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("proactive.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("schedule.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("agent.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("signals.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (
    n === "user.drag_start" ||
    n === "user.drag_end" ||
    n === "user.tap" ||
    n === "user.tap_region" ||
    n === "user.pat_start" ||
    n === "user.pat_end" ||
    n === "user.window_sit_enter" ||
    n === "user.window_sit_exit" ||
    n === "user.window_sit_drop" ||
    n === "user.peek_drop" ||
    n === "user.peek_exit" ||
    n === "avatar.walk_start" ||
    n === "avatar.walk_end" ||
    n === "avatar.climb_start" ||
    n === "avatar.climb_end" ||
    n === "avatar.window_sit" ||
    n === "avatar.jump" ||
    n === "user.fall_land"
  ) {
    return { tier: 1, target: "tier1" };
  }
  return { tier: (env.hint_tier ?? 3) as Tier, target: "drop" };
}

/** Source of a user-initiated turn (typed vs voice) — filters onUserTurnFailed targets and hints routing.
 * Other triggers such as proactive/schedule/agent are undefined (§274, not a UI error-surface target). */
export type UserTurnSource = "text" | "voice";

export function userTurnSourceOf(env: BusEnvelope): UserTurnSource | undefined {
  if (env.event_name === "user.text_submitted") return "text";
  if (env.event_name === "user.voice_segment_ready") return "voice";
  return undefined;
}

/**
 * Which sources the global proactive gap applies to. Loop cues, schedule and the buffered
 * inboxes (signals, agent) all push as timer_scheduler, screen transitions as screen_watcher;
 * gesture cues, typed/spoken input and the once-a-day milestone push as os_event_watcher and
 * pass ungated. Record forces a new source value to answer paced-or-not at compile time.
 */
export const PACED_SOURCES: Record<BusEnvelope["source"], boolean> = {
  timer_scheduler: true,
  screen_watcher: true,
  os_event_watcher: false,
  user_input_source: false,
};
