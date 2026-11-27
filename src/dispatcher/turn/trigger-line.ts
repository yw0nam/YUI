/** Why she spoke: the line a self-started turn's bubble shows, or null for a turn it does not name. */

import type { BusEnvelope } from "../core/event-bus";

/** Catalog lookup for the line's fixed phrases; ui's `t` satisfies it. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

function payloadText(env: BusEnvelope, key: string): string | null {
  const value = env.payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ownLineOf(env: BusEnvelope, translate: Translate): string | null {
  const event = env.event_name;
  if (env.source === "timer_scheduler" && event.startsWith("schedule.")) {
    const time = payloadText(env, "time");
    const label = payloadText(env, "label");
    return time !== null && label !== null ? `${time} ${label}` : null;
  }
  if (env.source === "timer_scheduler" && event.startsWith("proactive.")) {
    return payloadText(env, "label");
  }
  if (event === "time_milestone.first_activity") {
    return translate("bubble.trigger_first_meeting");
  }
  if (env.source === "screen_watcher" && event === "proactive.screen_app_switched") {
    const app = payloadText(env, "app");
    return app !== null ? translate("bubble.trigger_screen", { app }) : null;
  }
  if (env.source === "addressed_source" && event.startsWith("addressed.")) {
    const from = payloadText(env, "name");
    return from !== null ? translate("bubble.trigger_addressed", { name: from }) : null;
  }
  return null;
}

export function triggerLineOf(env: BusEnvelope, translate: Translate): string | null {
  if (env.event_name.startsWith("user.")) return null;
  const line = ownLineOf(env, translate);
  const raw = env.payload?.waited;
  if (!Array.isArray(raw)) return line;
  const members = raw.filter(
    (member): member is BusEnvelope =>
      typeof (member as BusEnvelope | null)?.event_name === "string",
  );
  const first =
    line ?? members.map((member) => ownLineOf(member, translate)).find((text) => text !== null);
  if (first === null || first === undefined) return null;
  const groups = Array.isArray(env.payload?.signals) ? env.payload.signals.length : 0;
  const rest = members.length + groups;
  return rest > 0 ? `${first} +${rest}` : first;
}
