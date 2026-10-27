/**
 * routed-user-source — the receiving half of the unified chat window's messages.
 *
 * Subscribes to the user-turn-routed bridge events, keeps the ones naming this preset, and submits
 * each as a user turn that carries its send id, mention, and whether the user spoke it.
 *
 * firing ≠ judgment: this only submits the user's text; the backend decides whether/what to speak.
 */

import type { UserTurnRouted } from "../../../io/bridge/settings-bridge";
import { createLogger } from "../../../logger";
import type { UserInputSource } from "../user-input-source";

const log = createLogger("routed-user-source");

export function createRoutedUserSource(deps: {
  selfPresetId: string;
  subscribe: (cb: (event: UserTurnRouted) => void) => () => void;
  submit: UserInputSource["submit"];
}): { start(): void; stop(): void } {
  let unsubscribe: (() => void) | null = null;

  return {
    start() {
      unsubscribe = deps.subscribe((event) => {
        if (event.to !== deps.selfPresetId) return;
        deps.submit(event.text, [], {
          mention: event.mention,
          sendId: event.sendId,
          ...(event.via ? { via: event.via } : {}),
        });
        log.info("fire", { mention: event.mention ?? "none" });
      });
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
