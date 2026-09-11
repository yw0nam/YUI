/**
 * milestone_source — once-per-day client clock facts.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and fires
 * `time_milestone.first_activity` (tier2) on the first tick of the local day that finds
 * the user "present" (OS idle within `present_max_idle_ms`). The day key is persisted
 * across restarts; `isEnabled()` gates firing only, without stopping the subscription.
 * Buffered `/signals` groups ride the same candidate event.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import type { SignalGroup } from "../contract";
import { isPlainObject, localStorageStore, type PersistedStorage } from "../io/persisted-store";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { subscribeOsEvent } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { BusEnvelope, EventBus } from "./event-bus";

const log = createLogger("milestone-source");

const MILESTONE_NAME = "first_activity";

interface MilestoneSourceDeps {
  bus: Pick<EventBus, "push">;
  present_max_idle_ms: number;
  /** Read inside the tick handler — gates firing without stopping the source. */
  isEnabled: () => boolean;
  /** Takes every buffered `/signals` group and empties the buffers. */
  drainSignals: () => SignalGroup[];
  /** Injectable channel listen; defaults to the resolved Tauri `listen`. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Injectable fired-latch persistence; defaults to the `yui.milestone-fired` store. */
  firedStorage?: PersistedStorage<Record<string, string>>;
}

export interface MilestoneSource {
  start(): Promise<void>;
  stop(): void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function createMilestoneSource(deps: MilestoneSourceDeps): MilestoneSource {
  const { bus, present_max_idle_ms, isEnabled, drainSignals } = deps;
  const now = deps.now ?? Date.now;
  const firedStorage =
    deps.firedStorage ?? localStorageStore<Record<string, string>>("yui.milestone-fired");
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
    if (idle > present_max_idle_ms) return;
    if (!isEnabled()) return;

    const ts = now();
    const d = new Date(ts);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (fired[MILESTONE_NAME] === dayKey) return;

    const localTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    // ponytail: pushing as timer_scheduler means the pacer can drop this candidate, and the
    // drained groups ride it — same ceiling as proactive.tap_bored.
    const env: BusEnvelope = {
      source: "timer_scheduler",
      event_name: `time_milestone.${MILESTONE_NAME}`,
      ts,
      hint_tier: 2,
      dnd_override: false,
      payload: {
        name: MILESTONE_NAME,
        local_time: localTime,
        signals: drainSignals(),
      },
    };
    bus.push(env);
    log.info("fire", { name: MILESTONE_NAME, local_time: localTime });
    fired[MILESTONE_NAME] = dayKey;
    firedStorage.save({ ...fired });
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
