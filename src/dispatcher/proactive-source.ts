/**
 * proactive_source — idle-gap proactive firing source.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and
 * fires `proactive.<cue_id>` (tier2) when the user is "present" (OS idle within
 * `present_max_idle_ms`) and a cue's gap has reached `cue.idle_min` minutes.
 * Each cue then re-fires on that same `cue.idle_min` period for as long as the
 * user stays present. When several cues come due in one tick they share a single
 * tick timestamp and push longest-`idle_min` first. `noteInteraction` re-anchors
 * the gap and clears the per-cue schedules. `isEnabled()` and per-cue `enabled`
 * gate firing only — toggling does not stop the subscription. Presence alone does
 * NOT reset the gap.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import type { ProactiveCue } from "../io/proactive-settings";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { subscribeOsEvent } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { BusEnvelope, EventBus } from "./event-bus";

const log = createLogger("proactive-source");

interface ProactiveSourceDeps {
  bus: Pick<EventBus, "push">;
  present_max_idle_ms: number;
  getCues: () => ProactiveCue[];
  /** Read inside the tick handler — gates firing without stopping the source. */
  isEnabled: () => boolean;
  /** Injectable channel listen; defaults to the resolved Tauri `listen`. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface ProactiveSource {
  start(): Promise<void>;
  stop(): void;
  /** Re-anchor the idle gap and clear per-cue latches (user activity edge). */
  noteInteraction(ts?: number): void;
}

export function createProactiveSource(deps: ProactiveSourceDeps): ProactiveSource {
  const { bus, present_max_idle_ms, getCues, isEnabled } = deps;
  const now = deps.now ?? Date.now;

  let unlisten: (() => void) | undefined;
  let lastInteractionTs = 0;
  const lastFired = new Map<string, number>();

  function noteInteraction(ts?: number): void {
    lastInteractionTs = ts ?? now();
    lastFired.clear();
  }

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    const idle = payload.data.os_idle_ms;
    // Null idle (e.g. Windows) carries no presence signal — ignore entirely.
    if (idle == null) return;

    const present = idle <= present_max_idle_ms;
    if (!present) return;

    if (!isEnabled()) return;

    const tickNow = now();
    const gap = tickNow - lastInteractionTs;
    // Longest idle_min first so the longer-term cue wins same-tick push order.
    const cues = [...getCues()].sort((a, b) => b.idle_min - a.idle_min);
    for (const cue of cues) {
      if (!cue.enabled) continue;
      const anchor = lastFired.get(cue.id) ?? lastInteractionTs;
      if (tickNow - anchor < cue.idle_min * 60_000) continue;
      const env: BusEnvelope = {
        source: "timer_scheduler",
        event_name: `proactive.${cue.id}`,
        ts: tickNow,
        hint_tier: 2,
        dnd_override: false,
        payload: {
          cue_id: cue.id,
          label: cue.label,
          context: cue.context,
          idle_min: cue.idle_min,
          gap_ms: gap,
        },
      };
      bus.push(env);
      lastFired.set(cue.id, tickNow);
    }
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    lastInteractionTs = now();
    unlisten = await subscribeOsEvent({ listen: deps.listen, onTick, log });
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
  }

  return { start, stop, noteInteraction };
}
