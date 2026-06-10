/**
 * cowork_source — co-working presence+cadence firing source.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and
 * fires `proactive.cowork` (tier2) on a presence+cadence state machine: the user
 * is "present" when OS idle time stays within `present_max_idle_ms`; while held
 * present, the source fires every `interval_ms`. The away→present edge re-anchors
 * the cadence (no fire on return). `isEnabled()` gates firing only — toggling does
 * not stop the subscription nor reset cadence state.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import { createLogger } from "../logger";
import { OS_EVENT_CHANNEL, resolveTauriListen } from "../io/tauri-listen";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { BusEnvelope, EventBus } from "./event-bus";

const log = createLogger("cowork_source");

export interface CoworkSourceDeps {
  bus: Pick<EventBus, "push">;
  cowork: { interval_ms: number; present_max_idle_ms: number };
  /** Read inside the tick handler — gates firing without stopping the source. */
  isEnabled: () => boolean;
  /** Injectable channel listen; defaults to the resolved Tauri `listen`. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface CoworkSource {
  start(): Promise<void>;
  stop(): void;
}

export function createCoworkSource(deps: CoworkSourceDeps): CoworkSource {
  const { bus, cowork, isEnabled } = deps;
  const now = deps.now ?? Date.now;

  let unlisten: (() => void) | undefined;
  let wasPresent = false;
  let lastFireTs = 0;

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    const idle = payload.data.os_idle_ms;
    // Null idle (e.g. Windows) carries no presence signal — ignore entirely.
    if (idle == null) return;

    const present = idle <= cowork.present_max_idle_ms;

    // away→present edge: re-anchor cadence, do not fire this tick.
    if (present && !wasPresent) {
      lastFireTs = now();
      wasPresent = true;
      return;
    }
    if (!present) {
      wasPresent = false;
      return;
    }

    // held present: fire on cadence, only when enabled.
    if (isEnabled() && now() - lastFireTs >= cowork.interval_ms) {
      const env: BusEnvelope = {
        source: "timer_scheduler",
        event_name: "proactive.cowork",
        ts: now(),
        hint_tier: 2,
        dnd_override: false,
        payload: { os_idle_ms: idle },
      };
      bus.push(env);
      lastFireTs = now();
    }
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    let listen: OsEventListen | undefined;
    try {
      listen = deps.listen ?? (await resolveTauriListen());
    } catch (err) {
      log.debug("listen resolve failed — degrade:", err);
      return;
    }
    if (!listen) return;
    try {
      unlisten = await listen(OS_EVENT_CHANNEL, ({ payload }) => onTick(payload));
    } catch (err) {
      log.debug("subscribe failed — degrade:", err);
    }
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
  }

  return { start, stop };
}
