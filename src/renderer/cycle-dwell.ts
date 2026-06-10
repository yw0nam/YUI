/**
 * cycle-dwell — single-timer scheduler for a cycle motion's variant swap.
 *
 * When a cycle motion's clip finishes and its registry entry carries
 * cycle_dwell_ms > 0, the swap to the next variant is held for that many ms while
 * the clip clamps on its settled last frame. Any new motion play (drag interrupt,
 * emotion oneshot, exit→idle) cancels a pending dwell via cancel() so an interrupt
 * is never delayed and no stale swap fires after the motion changed. Non-cycle
 * motions and absent/0 dwell swap immediately.
 *
 * No three.js import — pure timer state, testable with fake timers.
 */

export interface CycleDwell {
  /**
   * Call on clip finish. Holds runSwap for dwellMs when isCycle and dwellMs > 0
   * (single cancellable timer, replacing any pending one); otherwise runs runSwap now.
   */
  onFinish(isCycle: boolean, dwellMs: number | undefined, runSwap: () => void): void;
  /** Cancel any pending deferred swap. Idempotent and safe with nothing pending. */
  cancel(): void;
  /** True while a deferred swap is scheduled. */
  pending(): boolean;
}

export function createCycleDwell(): CycleDwell {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    onFinish(isCycle, dwellMs, runSwap) {
      cancel();
      if (isCycle && dwellMs !== undefined && dwellMs > 0) {
        timer = setTimeout(() => {
          timer = null;
          runSwap();
        }, dwellMs);
      } else {
        runSwap();
      }
    },
    cancel,
    pending() {
      return timer !== null;
    },
  };
}
