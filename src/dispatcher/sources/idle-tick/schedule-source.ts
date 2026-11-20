/**
 * schedule_source — clock-time schedule firing source.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and
 * fires `schedule.<cue_id>` (tier2) when the user is "present" (OS idle within
 * `present_max_idle_ms`). Each cue fires at most once per local day, persisted
 * across restarts, within two hours after `cue.time`, and at most one cue fires per tick. `isEnabled()` and per-cue
 * `enabled` gate firing only — toggling does not stop the subscription.
 * A fire the dispatcher drops at a hold clears its day's mark, so it comes due again inside that window.
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
import type { DropRecord } from "../../dispatcher";

const log = createLogger("schedule-source");

export const GRACE_MINUTES = 120;

/** The holds `isHeld` also waits out. */
const HOLD_REASONS: ReadonlySet<DropRecord["reason"]> = new Set(["global_gap", "dnd"]);

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
  /** Do-not-disturb or the proactive gap: a held cue is not latched, so it fires on the first tick after the hold inside its window. */
  isHeld?: () => boolean;
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
  /** A held fire comes due again: clears the cue's day mark when the drop landed on it. */
  restore(env: BusEnvelope, reason: DropRecord["reason"]): void;
}

export function createScheduleSource(deps: ScheduleSourceDeps): ScheduleSource {
  const { bus, present_max_idle_ms, getCues, isEnabled, isHeld } = deps;
  const now = deps.now ?? Date.now;
  const firedStorage =
    deps.firedStorage ?? localStorageStore<Record<string, string>>("yui.schedule-fired");
  const loaded = firedStorage.load();
  const fired: Record<string, string> = isPlainObject(loaded)
    ? (loaded as Record<string, string>)
    : {};

  let unlisten: (() => void) | undefined;

  function saveFired(dayKey: string): void {
    firedStorage.save(
      Object.fromEntries(Object.entries(fired).filter(([, value]) => value === dayKey)),
    );
  }

  function restore(env: BusEnvelope, reason: DropRecord["reason"]): void {
    if (!HOLD_REASONS.has(reason)) return;
    if (!env.event_name.startsWith("schedule.")) return;
    const cueId = env.payload?.cue_id;
    if (typeof cueId !== "string") return;
    const dayKey = dayKeyOf(env.ts);
    if (fired[cueId] !== dayKey) return;
    delete fired[cueId];
    saveFired(dayKeyOf(now()));
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
    if (isHeld?.()) return;

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
        ts,
        payload: {
          cue_id: cue.id,
          label: cue.label,
          context: cue.context,
        },
      };
      bus.push(env);
      log.info("fire", { cue_id: cue.id, local_time: currentHHMM });
      fired[cue.id] = dayKey;
      firedAny = true;
      // One cue per tick: the turn it starts anchors the gap, which then holds the next due cue unlatched.
      break;
    }
    if (firedAny) saveFired(dayKey);
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    unlisten = await subscribeOsEvent({ listen: deps.listen, onTick, log });
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
  }

  return { start, stop, restore };
}
