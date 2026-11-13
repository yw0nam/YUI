/** reaction-thresholds — the waiting-count edge and the per-Thread long wait that start a Thread reaction without a chip tap. */

import type { Thread } from "../../contract";

export type ThresholdReach = { cause: "count" } | { cause: "wait"; threadId: string };

export function createReactionThresholds(deps: {
  /** The waiting count N; 0 is Off. */
  count(): number;
  /** The wait T in minutes as ms; 0 is Off. */
  waitMs(): number;
  now(): number;
  onReach(cause: ThresholdReach): void;
}): {
  /** Adopts the counted Threads: arms and reaches the count edge, starts and drops waits. */
  next(counted: readonly Thread[]): void;
  /** Re-arms the count without reaching and reschedules the wait timer, after a thresholds change. */
  recheck(): void;
  dispose(): void;
} {
  // Insertion order is first-counted order; `since` is when the Thread entered the counted list.
  const seen = new Map<string, { since: number; reached: boolean }>();
  let lastCounted: readonly Thread[] = [];
  // null until the baseline; a baseline reaches nothing.
  let armed: boolean | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function schedule(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const wait = deps.waitMs();
    if (wait === 0 || disposed) return;
    let earliest: number | null = null;
    for (const entry of seen.values()) {
      if (entry.reached) continue;
      const due = entry.since + wait;
      if (earliest === null || due < earliest) earliest = due;
    }
    if (earliest === null) return;
    timer = setTimeout(fireDue, Math.max(0, earliest - deps.now()));
  }

  function fireDue(): void {
    timer = null;
    if (disposed) return;
    const wait = deps.waitMs();
    if (wait === 0) return;
    const now = deps.now();
    const due = [...seen.entries()]
      .filter(([, entry]) => !entry.reached && entry.since + wait <= now)
      .sort((a, b) => a[1].since - b[1].since);
    for (const [id, entry] of due) {
      entry.reached = true;
      deps.onReach({ cause: "wait", threadId: id });
    }
    schedule();
  }

  return {
    next(counted) {
      const now = deps.now();
      const ids = new Set(counted.map((thread) => thread.id));
      for (const id of [...seen.keys()]) {
        if (!ids.has(id)) seen.delete(id);
      }
      for (const thread of counted) {
        if (!seen.has(thread.id)) seen.set(thread.id, { since: now, reached: false });
      }
      lastCounted = counted;
      const n = deps.count();
      if (armed === null) {
        armed = counted.length < n;
      } else if (armed && n > 0 && counted.length >= n) {
        armed = false;
        deps.onReach({ cause: "count" });
      } else if (n === 0 || counted.length < n) {
        armed = true;
      }
      schedule();
    },
    recheck() {
      armed = lastCounted.length < deps.count();
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
