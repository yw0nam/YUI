/**
 * schedule_source — clock-time schedule firing source.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and
 * fires `schedule.<cue_id>` (tier2) when the user is "present" (OS idle within
 * `present_max_idle_ms`), within two hours after `cue.time`, at most one cue per tick. A cue pushes
 * once per local day per run; it is persisted as fired only once its turn ends ok (`markSpoken`), so a
 * restart inside its grace window brings back a cue that was never spoken. `isEnabled()` and per-cue
 * `enabled` gate firing only — toggling does not stop the subscription.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import type { OsEventListen, OsEventPayload } from "../../../io/window/tauri-listen";
import { subscribeOsEvent } from "../../../io/window/tauri-listen";
import { createLogger } from "../../../logger";
import type { ScheduledCue } from "../../../settings/cues/schedule-settings";
import {
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../../../settings/persisted-store";
import type { BusEnvelope, EventBus } from "../../core/event-bus";

const log = createLogger("schedule-source");

export const GRACE_MINUTES = 120;

function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

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
  /** A turn ended ok: persists the day mark of each of this source's cues it carried, itself or in `payload.waited`. */
  markSpoken(env: BusEnvelope): void;
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

  // Cues pushed this run, as `<cue id>@<day>`: a pushed cue waits in the dispatcher, so it pushes once.
  const pushed = new Set<string>();
  let unlisten: (() => void) | undefined;

  function saveFired(dayKey: string): void {
    firedStorage.save(
      Object.fromEntries(Object.entries(fired).filter(([, value]) => value === dayKey)),
    );
  }

  function markSpoken(env: BusEnvelope): void {
    const waited = Array.isArray(env.payload?.waited) ? (env.payload.waited as BusEnvelope[]) : [];
    let marked = false;
    for (const e of [env, ...waited]) {
      const cueId = e.payload?.cue_id;
      if (!e.event_name.startsWith("schedule.") || typeof cueId !== "string") continue;
      fired[cueId] = dayKeyOf(e.ts);
      marked = true;
    }
    if (marked) saveFired(dayKeyOf(now()));
  }

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    const idle = payload.data.os_idle_ms;
    // Null idle (e.g. Windows) carries no presence signal — ignore entirely.
    if (idle == null) return;

    const present = idle <= present_max_idle_ms;
    if (!present) return;

    const ts = now();
    const d = new Date(ts);
    const dayKey = dayKeyOf(ts);
    const currentHHMM = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const nowMinutes = d.getHours() * 60 + d.getMinutes();

    if (!isEnabled()) return;

    for (const cue of getCues()) {
      const [cueHour, cueMinute] = cue.time.split(":").map(Number);
      const cueMinutes = cueHour * 60 + cueMinute;
      if (!Number.isFinite(cueMinutes)) continue;
      const delta = nowMinutes - cueMinutes;
      // ponytail: the window clamps at midnight, so a 23:00 cue gets 60 minutes, not 120 — wrap
      // it if that bites.
      const key = `${cue.id}@${dayKey}`;
      if (!cue.enabled || fired[cue.id] === dayKey || pushed.has(key)) continue;
      if (delta < 0 || delta > GRACE_MINUTES) continue;
      const env: BusEnvelope = {
        source: "timer_scheduler",
        event_name: `schedule.${cue.id}`,
        ts,
        payload: {
          cue_id: cue.id,
          label: cue.label,
          context: cue.context,
          time: cue.time,
        },
      };
      bus.push(env);
      log.info("fire", { cue_id: cue.id, local_time: currentHHMM });
      pushed.add(key);
      // One cue per tick; the next due cue pushes on the next tick and waits beside it.
      break;
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

  return { start, stop, markSpoken };
}
