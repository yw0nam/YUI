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
  // Insertion order is arrival order; a replaced reaction moves to the back.
  const held = new Map<string, ThreadTransition>();
  return {
    hold(t) {
      held.delete(t.id);
      held.set(t.id, t);
    },
    prune(snapshot) {
      const states = new Map(snapshot.threads.map((thread) => [thread.id, thread.state]));
      for (const [id, t] of held) if (states.get(id) !== t.state) held.delete(id);
    },
    take() {
      const first = held.values().next();
      if (first.done) return null;
      held.delete(first.value.id);
      return first.value;
    },
    isEmpty: () => held.size === 0,
    clear: () => held.clear(),
  };
}
