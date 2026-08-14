/**
 * TTFT filler loop scheduler — owns WHAT/WHEN to speak filler.
 *
 * Lifecycle:
 *   start()           — mark active, speak first phrase (or schedule first repeat)
 *   onUtteranceDone() — schedule the next repeat after the gap+jitter delay
 *   onSynthFailure()  — stay silent for the rest of this window
 *   stop()            — cancel pending timer, mark inactive
 *
 * Pools and timing are read live on each turn so hot-reload takes effect immediately.
 * Bounded: at most one pending timer at any time; no cascading schedule on fire.
 */

export interface FillerLoopDeps {
  speak: (text: string) => void;
  getPools: () => { first: string[]; repeat: string[] };
  getTiming: () => { gapMs: number; jitterMs: number };
  /** Test seam — defaults to globalThis.setTimeout. */
  setTimeout?: typeof globalThis.setTimeout;
  /** Test seam — defaults to globalThis.clearTimeout. */
  clearTimeout?: typeof globalThis.clearTimeout;
  /** Test seam — defaults to Math.random. */
  random?: () => number;
}

export interface FillerLoop {
  start(): void;
  onUtteranceDone(): void;
  /** A failed synth request means no phrase can be spoken — stay silent until the next start(). */
  onSynthFailure(): void;
  stop(): void;
}

export function createFillerLoop(deps: FillerLoopDeps): FillerLoop {
  const setTimer = deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const rng = deps.random ?? Math.random;

  let active = false;
  let suppressed = false;
  let pendingTimer: ReturnType<typeof setTimer> | undefined;
  let lastFirst: string | undefined;
  let lastRepeat: string | undefined;

  function pick(list: string[], last: string | undefined): string {
    let index = Math.min(list.length - 1, Math.floor(rng() * list.length));
    if (list.length > 1 && list[index] === last) {
      index = (index + 1) % list.length;
    }
    return list[index]!;
  }

  function cancelTimer(): void {
    if (pendingTimer !== undefined) {
      clearTimer(pendingTimer);
      pendingTimer = undefined;
    }
  }

  function scheduleNext(): void {
    cancelTimer();
    const { gapMs, jitterMs } = deps.getTiming();
    const delay = Math.max(0, gapMs + (rng() * 2 - 1) * jitterMs);
    pendingTimer = setTimer(() => {
      pendingTimer = undefined;
      if (!active) return;
      const { repeat } = deps.getPools();
      if (repeat.length === 0) return;
      const phrase = pick(repeat, lastRepeat);
      lastRepeat = phrase;
      deps.speak(phrase);
    }, delay);
  }

  return {
    start() {
      active = true;
      suppressed = false;
      lastFirst = undefined;
      lastRepeat = undefined;
      const { first, repeat } = deps.getPools();
      if (first.length > 0) {
        const phrase = pick(first, lastFirst);
        lastFirst = phrase;
        deps.speak(phrase);
      } else if (repeat.length > 0) {
        scheduleNext();
      }
    },

    onUtteranceDone() {
      if (!active || suppressed) return;
      const { repeat } = deps.getPools();
      if (repeat.length > 0) scheduleNext();
    },

    onSynthFailure() {
      suppressed = true;
      cancelTimer();
    },

    stop() {
      active = false;
      cancelTimer();
    },
  };
}
