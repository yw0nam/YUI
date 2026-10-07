/**
 * wake_source — the character got out of the launch bed.
 *
 * Fires one `proactive.wake` candidate per click or timeout wake, naming its cause. While the
 * day's first activity is owed, the same candidate carries it with the drained `/signals`
 * groups, and the day is latched once the bus takes it.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import type { SignalGroup, WakeCause } from "../../../contract";
import { createLogger } from "../../../logger";
import type { EventBus } from "../../core/event-bus";
import type { MilestoneSource } from "../idle-tick/milestone-source";

const log = createLogger("wake-source");

type SignalledWake = Exclude<WakeCause, "message">;

export interface WakeSource {
  fire(cause: SignalledWake): void;
}

export function createWakeSource(deps: {
  bus: Pick<EventBus, "push">;
  firstActivity: Pick<MilestoneSource, "owed" | "latch">;
  /** Takes every buffered `/signals` group and empties the buffers. */
  drainSignals: () => SignalGroup[];
  now?: () => number;
}): WakeSource {
  const now = deps.now ?? Date.now;
  return {
    fire(cause) {
      const ts = now();
      const first = deps.firstActivity.owed(ts);
      let signals: SignalGroup[] = [];
      if (first) {
        try {
          signals = deps.drainSignals();
        } catch (error) {
          log.warn("signal drain failed", error);
        }
      }
      const pushed = deps.bus.push({
        source: "os_event_watcher",
        event_name: "proactive.wake",
        ts,
        payload: {
          cause,
          ...(first ?? {}),
          ...(signals.length > 0 ? { signals } : {}),
        },
      });
      if (!pushed) {
        log.warn("push rejected", { cause });
        return;
      }
      if (first) deps.firstActivity.latch(ts);
      log.info("fire", { cause, first_activity: first !== null });
    },
  };
}
