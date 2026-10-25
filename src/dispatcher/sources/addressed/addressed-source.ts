/**
 * addressed-source — the receiving half of the addressed turns.
 *
 * Subscribes to the character-addressed bridge events, keeps the ones naming this preset, and
 * pushes one `addressed.character` candidate each. The envelope's `ts` is when the reply was
 * spoken, which the trigger headline reads as "Nmin ago".
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides whether/what to
 * speak.
 */

import type { CharacterAddressed } from "../../../io/bridge/settings-bridge";
import { createLogger } from "../../../logger";
import type { EventBus } from "../../core/event-bus";

const log = createLogger("addressed-source");

export interface AddressedSource {
  start(): void;
  stop(): void;
}

export function createAddressedSource(deps: {
  bus: Pick<EventBus, "push">;
  selfPresetId: string;
  subscribe: (cb: (event: CharacterAddressed) => void) => () => void;
}): AddressedSource {
  let unsubscribe: (() => void) | null = null;

  return {
    start() {
      unsubscribe = deps.subscribe((event) => {
        if (event.to !== deps.selfPresetId) return;
        const pushed = deps.bus.push({
          source: "addressed_source",
          event_name: "addressed.character",
          ts: event.ts,
          payload: { from: event.from, name: event.name, line: event.text },
        });
        if (!pushed) {
          log.info("push rejected", { from: event.from });
          return;
        }
        log.info("fire", { from: event.from });
      });
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
