/**
 * motion-finish-waiters — id-keyed clean-finish waiters for the fall sequence.
 * No three.js import. Pure promise bookkeeping.
 *
 * The renderer registers a waiter per `whenMotionFinished(id)` call and resolves
 * it from the mixer natural-finish path only. A consumed finish (resolve → true)
 * tells onMixerFinished to skip the controller auto-swap — the awaiting fall
 * controller owns the follow-up motion. A cut/replaced clip never settles a
 * waiter; clear() (teardown/hotswap) drops pending waiters unsettled.
 */

export interface MotionFinishWaiters {
  /** Resolves when `resolve(id)` fires for this exact id. Never on a cut clip. */
  wait(id: string): Promise<void>;
  /** Settle every waiter for `id`. True iff any were consumed. */
  resolve(id: string): boolean;
  /** Drop all pending waiters without settling them. */
  clear(): void;
}

export function createMotionFinishWaiters(): MotionFinishWaiters {
  const waiters = new Map<string, Array<() => void>>();

  return {
    wait(id) {
      return new Promise<void>((res) => {
        const list = waiters.get(id) ?? [];
        list.push(res);
        waiters.set(id, list);
      });
    },
    resolve(id) {
      const list = waiters.get(id);
      if (!list || list.length === 0) return false;
      waiters.delete(id);
      for (const r of list) r();
      return true;
    },
    clear() {
      waiters.clear();
    },
  };
}
