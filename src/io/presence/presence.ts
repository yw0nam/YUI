/** presence — the last OS idle tick read against the away threshold, for main's pet window. */

import { createLogger } from "../../logger";
import { type OsEventListen, type OsEventPayload, subscribeOsEvent } from "../window/tauri-listen";

const log = createLogger("presence");

export function createPresence(deps: {
  /** Idle ms at or below which the user counts as present. */
  threshold: () => number;
  /** Injectable channel listen; defaults to the resolved Tauri listen. */
  listen?: OsEventListen;
}): { isPresent(): boolean; dispose(): void } {
  let lastIdleMs: number | null = null;
  let unlisten: (() => void) | undefined;
  let disposed = false;

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    lastIdleMs = payload.data.os_idle_ms ?? null;
  }

  void subscribeOsEvent({
    listen: deps.listen,
    onTick,
    log,
    subscribeTag: "subscribe_failed",
  }).then((result) => {
    // A subscription resolving after dispose must not leak its unlisten.
    if (disposed) result?.();
    else unlisten = result;
  });

  return {
    isPresent: () => lastIdleMs != null && lastIdleMs <= deps.threshold(),
    dispose() {
      disposed = true;
      unlisten?.();
      unlisten = undefined;
    },
  };
}
