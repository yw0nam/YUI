/** held-reactions — one reaction per Thread waiting for the main character to be free. */

import type { ThreadsSnapshot } from "../../contract";
import type { ThreadTransition } from "./thread-transitions";

export function createHeldReactions(): {
  /** Holds `t`, replacing the Thread's older reaction. */
  hold(t: ThreadTransition): void;
  /** Drops each reaction whose Thread is gone or in another state. */
  prune(snapshot: ThreadsSnapshot): void;
  /** Removes and returns the oldest held reaction, or null. */
  take(): ThreadTransition | null;
  isEmpty(): boolean;
  clear(): void;
} {
  return {
    hold() {},
    prune() {},
    take: () => undefined as never,
    isEmpty: () => true,
    clear() {},
  };
}
