/**
 * TTFT filler loop scheduler — owns WHAT/WHEN to speak filler.
 *
 * Lifecycle:
 *   start()           — mark active, speak first phrase (or schedule first repeat)
 *   onUtteranceDone() — schedule the next repeat after the gap+jitter delay
 *   onSynthFailure()  — degrade: speak only what the cache already holds
 *   stop()            — cancel pending timer, mark inactive
 *
 * Pools and timing are read live on each turn so hot-reload takes effect immediately.
 * Bounded: at most one pending timer at any time; no cascading schedule on fire.
 */

import { createLogger, type Logger } from "../logger";

export interface FillerLoopDeps {
  speak: (text: string) => void;
  getPools: () => { first: string[]; repeat: string[] };
  getTiming: () => { gapMs: number; jitterMs: number };
  /** Whether the phrase can be spoken without reaching the TTS server. */
  isCached: (phrase: string) => boolean;
  logger?: Logger;
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
  /** A failed synth request means the server is unreachable — speak cached phrases only until the next start(). */
  onSynthFailure(): void;
  stop(): void;
}

export function createFillerLoop(deps: FillerLoopDeps): FillerLoop {
  const log: Logger = deps.logger ?? createLogger("filler-loop");
  const setTimer = deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const rng = deps.random ?? Math.random;

  let active = false;
  let degraded = false;
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

  // Degraded, a phrase is speakable only if its audio is already in hand; an empty result means
  // there is genuinely nothing to play and the window stays silent.
  function repeatCandidates(): string[] {
    const { repeat } = deps.getPools();
    return degraded ? repeat.filter(deps.isCached) : repeat;
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
      const candidates = repeatCandidates();
      if (candidates.length === 0) return;
      const phrase = pick(candidates, lastRepeat);
      lastRepeat = phrase;
      deps.speak(phrase);
    }, delay);
  }

  return {
    start() {
      active = true;
      degraded = false;
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
      if (!active) return;
      if (repeatCandidates().length > 0) scheduleNext();
    },

    onSynthFailure() {
      cancelTimer();
      if (degraded) return;
      degraded = true;
      log.warn("degraded", { speakable: repeatCandidates().length });
    },

    stop() {
      active = false;
      cancelTimer();
    },
  };
}
