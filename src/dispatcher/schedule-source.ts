/**
 * schedule_source — clock-time schedule firing source.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and
 * fires `schedule.<cue_id>` (tier2) when the user is "present" (OS idle within
 * `present_max_idle_ms`) and the local wall-clock has reached `cue.time`. Each
 * cue fires at most once per local day; the firedToday latch clears on the day
 * boundary. `isEnabled()` and per-cue `enabled` gate firing only — toggling does
 * not stop the subscription.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import type { ScheduledCue } from "../io/schedule-settings";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { subscribeOsEvent } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { BusEnvelope, EventBus } from "./event-bus";

const log = createLogger("schedule-source");

interface ScheduleSourceDeps {
  bus: Pick<EventBus, "push">;
  present_max_idle_ms: number;
  getCues: () => ScheduledCue[];
  /** Read inside the tick handler — gates firing without stopping the source. */
  isEnabled: () => boolean;
  /** Injectable channel listen; defaults to the resolved Tauri `listen`. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface ScheduleSource {
  start(): Promise<void>;
  stop(): void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function createScheduleSource(deps: ScheduleSourceDeps): ScheduleSource {
  const { bus, present_max_idle_ms, getCues, isEnabled } = deps;
  const now = deps.now ?? Date.now;

  let unlisten: (() => void) | undefined;
  let lastDayKey = "";
  const firedToday = new Map<string, boolean>();

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    const idle = payload.data.os_idle_ms;
    // Null idle (e.g. Windows) carries no presence signal — ignore entirely.
    if (idle == null) return;

    const present = idle <= present_max_idle_ms;
    if (!present) return;

    const d = new Date(now());
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const currentHHMM = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

    if (dayKey !== lastDayKey) {
      firedToday.clear();
      lastDayKey = dayKey;
    }

    if (!isEnabled()) return;

    for (const cue of getCues()) {
      if (!cue.enabled || firedToday.has(cue.id) || currentHHMM < cue.time) continue;
      const env: BusEnvelope = {
        source: "timer_scheduler",
        event_name: `schedule.${cue.id}`,
        ts: now(),
        hint_tier: 2,
        dnd_override: false,
        payload: {
          cue_id: cue.id,
          label: cue.label,
          context: cue.context,
          local_time: currentHHMM,
        },
      };
      bus.push(env);
      firedToday.set(cue.id, true);
    }
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    unlisten = await subscribeOsEvent({ listen: deps.listen, onTick, log });
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
  }

  return { start, stop };
}
