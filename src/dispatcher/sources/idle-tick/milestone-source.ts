/**
 * milestone_source — once-per-day client clock facts.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and fires
 * `time_milestone.first_activity` (tier2) on the first tick of the local day that finds
 * the user "present" (OS idle within `present_max_idle_ms`). The day key is persisted
 * across restarts; `isEnabled()` and `isHeld()` gate firing only, without stopping the
 * subscription. Buffered `/signals` groups ride the same candidate event. Another source can
 * carry the owed first activity itself through `owed()` and `latch()`.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import type { SignalGroup } from "../../../contract";
import type { OsEventListen, OsEventPayload } from "../../../io/window/tauri-listen";
import { subscribeOsEvent } from "../../../io/window/tauri-listen";
import { createLogger } from "../../../logger";
import {
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../../../settings/persisted-store";
import type { BusEnvelope, EventBus } from "../../core/event-bus";

const log = createLogger("milestone-source");

const MILESTONE_NAME = "first_activity" as const;

interface MilestoneSourceDeps {
  bus: Pick<EventBus, "push">;
  present_max_idle_ms: number;
  /** Read inside the tick handler — gates firing without stopping the source. */
  isEnabled: () => boolean;
  /** True while the candidate waits; the day stays owed. */
  isHeld?: () => boolean;
  /** Takes every buffered `/signals` group and empties the buffers. */
  drainSignals: () => SignalGroup[];
  /** Injectable channel listen; defaults to the resolved Tauri `listen`. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Injectable fired-latch persistence; defaults to the `yui.milestone-fired` store. */
  firedStorage?: PersistedStorage<Record<string, string>>;
}

export interface FirstActivity {
  name: typeof MILESTONE_NAME;
  local_time: string;
}

export interface MilestoneSource {
  start(): Promise<void>;
  stop(): void;
  /** The day's first activity at `ts` while it is enabled and not yet latched, whatever the hold. */
  owed(ts: number): FirstActivity | null;
  /** Marks the day of `ts` as fired. */
  latch(ts: number): void;
}

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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

  function owed(ts: number): FirstActivity | null {
    if (!isEnabled()) return null;
    const d = new Date(ts);
    if (fired[MILESTONE_NAME] === dayKeyOf(d)) return null;
    const localTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return { name: MILESTONE_NAME, local_time: localTime };
  }

  function latch(ts: number): void {
    fired[MILESTONE_NAME] = dayKeyOf(new Date(ts));
    firedStorage.save({ ...fired });
  }

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    const idle = payload.data.os_idle_ms;
    // Null idle (e.g. Windows) carries no presence signal — ignore entirely.
    if (idle == null) return;
    if (idle > present_max_idle_ms) return;
    if (deps.isHeld?.()) return;

    const ts = now();
    const first = owed(ts);
    if (!first) return;
    let signals: SignalGroup[] = [];
    try {
      signals = drainSignals();
    } catch (error) {
      log.warn("signal drain failed", error);
    }
    // ponytail: the guardrail (cooldown, debounce, rate limit) and the degraded state can still
    // drop the candidate after the drain, and those groups are gone for the day — re-buffer them
    // on drop if that bites.
    const env: BusEnvelope = {
      source: "os_event_watcher",
      event_name: `time_milestone.${MILESTONE_NAME}`,
      ts,
      payload: {
        ...first,
        ...(signals.length > 0 ? { signals } : {}),
      },
    };
    if (!bus.push(env)) {
      log.warn("push rejected", { name: MILESTONE_NAME });
      return;
    }
    log.info("fire", first);
    latch(ts);
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    unlisten = await subscribeOsEvent({ listen: deps.listen, onTick, log });
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
  }

  return { start, stop, owed, latch };
}
