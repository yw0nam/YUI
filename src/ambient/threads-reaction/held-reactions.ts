/** held-reactions — one reaction per Thread waiting for the main character to be free. */

import type { ThreadsSnapshot } from "../../contract";
import type { ThreadTransition } from "./thread-transitions";

export function createHeldReactions(): {
  /** Holds `t`, replacing the Thread's older reaction. */
  hold(t: ThreadTransition): void;
  /** Drops each reaction whose Thread is gone or in another state, and returns their Thread ids. */
  prune(snapshot: ThreadsSnapshot): string[];
  /** Removes and returns the oldest held reaction, or null. */
  take(): ThreadTransition | null;
  isEmpty(): boolean;
  has(id: string): boolean;
  /** Drops every reaction and returns their Thread ids. */
  clear(): string[];
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
      const dropped = [...held.values()]
        .filter((t) => states.get(t.id) !== t.state)
        .map((t) => t.id);
      for (const id of dropped) held.delete(id);
      return dropped;
    },
    take() {
      const first = held.values().next();
      if (first.done) return null;
      held.delete(first.value.id);
      return first.value;
    },
    isEmpty: () => held.size === 0,
    has: (id) => held.has(id),
    clear() {
      const ids = [...held.keys()];
      held.clear();
      return ids;
    },
  };
}
