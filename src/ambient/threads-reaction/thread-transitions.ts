/** thread-transitions — diffs Thread snapshots for the state changes a Thread reaction answers. */

import type { Thread, ThreadsSnapshot } from "../../contract";

export interface ThreadTransition {
  id: string;
  state: Exclude<Thread["state"], "working">;
}

export function createThreadTransitions(): {
  /** The Threads that entered a reacting state since the last snapshot; the first call is the baseline and returns []. */
  next(snapshot: ThreadsSnapshot): ThreadTransition[];
} {
  let seen: Map<string, Thread["state"]> | undefined;
  return {
    next(snapshot) {
      const previous = seen;
      seen = new Map(snapshot.threads.map((thread) => [thread.id, thread.state]));
      if (!previous) return [];
      return snapshot.threads.flatMap(({ id, state }) =>
        state !== "working" && previous.get(id) !== state ? [{ id, state }] : [],
      );
    },
  };
}
