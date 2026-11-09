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
  return { next: () => undefined as never };
}
