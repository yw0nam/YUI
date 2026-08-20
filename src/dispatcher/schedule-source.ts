/**
 * schedule_source — clock-time schedule firing source.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and
 * fires `schedule.<cue_id>` (tier2) when the user is "present" (OS idle within
 * `present_max_idle_ms`). Each cue fires at most once per local day, persisted
 * across restarts, within two hours after `cue.time`. `isEnabled()` and per-cue
 * `enabled` gate firing only — toggling does not stop the subscription.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import { isPlainObject, localStorageStore, type PersistedStorage } from "../io/persisted-store";
import type { ScheduledCue } from "../io/schedule-settings";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { subscribeOsEvent } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { BusEnvelope, EventBus } from "./event-bus";

const log = createLogger("schedule-source");

export const GRACE_MINUTES = 120;

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
  /** Injectable fired-latch persistence; defaults to the `yui.schedule-fired` store. */
  firedStorage?: PersistedStorage<Record<string, string>>;
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
  const firedStorage =
    deps.firedStorage ?? localStorageStore<Record<string, string>>("yui.schedule-fired");
  const loaded = firedStorage.load();
  const fired: Record<string, string> = isPlainObject(loaded)
    ? (loaded as Record<string, string>)
    : {};

  let unlisten: (() => void) | undefined;

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
    const nowMinutes = d.getHours() * 60 + d.getMinutes();

    if (!isEnabled()) return;

    let firedAny = false;
    for (const cue of getCues()) {
      const [cueHour, cueMinute] = cue.time.split(":").map(Number);
      const cueMinutes = cueHour * 60 + cueMinute;
      if (!Number.isFinite(cueMinutes)) continue;
      const delta = nowMinutes - cueMinutes;
      // ponytail: the window clamps at midnight, so a 23:00 cue gets 60 minutes, not 120 — wrap
      // it if that bites.
      if (!cue.enabled || fired[cue.id] === dayKey || delta < 0 || delta > GRACE_MINUTES) continue;
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
      fired[cue.id] = dayKey;
      firedAny = true;
    }
    if (firedAny) {
      firedStorage.save(
        Object.fromEntries(Object.entries(fired).filter(([, value]) => value === dayKey)),
      );
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
