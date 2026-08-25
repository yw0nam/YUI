/**
 * Bounded, event-aware TTFT filler scheduler — owns WHAT/WHEN to speak while a turn is thinking.
 *
 * Lifecycle:
 *   start()           — mark active, speak the first phrase (or arm the first repeat), reset
 *                        per-turn state (bags persist across turns for the app's lifetime).
 *   onUtteranceDone()  — in phase "filler", arms the next repeat (backed off by gap_growth) or,
 *                        once max_repeats is spent, arms the single long_wait phrase.
 *   onToolRunning(id)  — moves to phase "tool": speaks that tool's own phrase once per turn (or a
 *                        budgeted _default fallback for an unknown id), then (re)arms long_wait.
 *   onActivity()       — restarts a pending long_wait timer from now (tool_status done/idle, express).
 *
 * long_wait fires long_wait_ms (un-jittered, config) after the last spoken filler/tool utterance
 * or activity event — once per turn, regardless of which phase armed it.
 *   onSynthFailure()   — degrade: speak only what the cache already holds; re-arms whatever
 *                        timer it had to cancel to get there, so the schedule keeps moving.
 *   stop()             — cancel the pending timer, mark inactive.
 *
 * Pools and timing are read live on each turn so hot-reload takes effect immediately.
 * Bounded: at most one pending timer at any time; long_wait fires once per turn, then nothing
 * follows until the next start().
 */

import type { FillerPool } from "../config/load";
import { createLogger, type Logger } from "../logger";
import { createShuffleBag, type ShuffleBag } from "./shuffle-bag";

export interface FillerLoopDeps {
  speak: (text: string) => void;
  getPools: () => FillerPool;
  getTiming: () => {
    gapMs: number;
    jitterMs: number;
    maxRepeats: number;
    gapGrowth: number;
    /** Un-jittered delay (ms) from the last spoken filler/tool utterance or activity event to long_wait. */
    longWaitMs: number;
  };
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
  /** A tool call started running — speaks an acknowledgment and (re)arms long_wait. */
  onToolRunning(toolId: string): void;
  /** Non-tool progress (tool done/idle, an express cue) — postpones a pending long_wait. */
  onActivity(): void;
  /** A failed synth request means the server is unreachable — speak cached phrases only until the next start(). */
  onSynthFailure(): void;
  stop(): void;
}

/** The tool tier's fallback key for a tool_id with no dedicated pool entry (or none at all). */
export const DEFAULT_TOOL_KEY = "_default";

export function createFillerLoop(deps: FillerLoopDeps): FillerLoop {
  const log: Logger = deps.logger ?? createLogger("filler-loop");
  const setTimer = deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const rng = deps.random ?? Math.random;

  // One bag per tier, living for the app's lifetime — start() resets per-turn state, never these.
  const firstBag = createShuffleBag(rng);
  const repeatBag = createShuffleBag(rng);
  const longWaitBag = createShuffleBag(rng);
  const defaultToolBag = createShuffleBag(rng);
  const toolBags = new Map<string, ShuffleBag>();

  let active = false;
  let degraded = false;
  let phase: "filler" | "tool" = "filler";
  let longWaitFired = false;
  let repeatsSpoken = 0;
  let spokenToolIds = new Set<string>();
  let defaultSpokenCount = 0;
  let pendingTimer: ReturnType<typeof setTimer> | undefined;
  let pendingKind: "repeat" | "long_wait" | undefined;

  function toolBagFor(id: string): ShuffleBag {
    let bag = toolBags.get(id);
    if (!bag) {
      bag = createShuffleBag(rng);
      toolBags.set(id, bag);
    }
    return bag;
  }

  // Degraded, a drawn phrase is speakable only if its audio is already in hand. Returns whether it
  // actually spoke: a speak() that never happened produces no playback, so no onUtteranceDone will
  // ever arrive for it — callers that get `false` back must advance the schedule themselves.
  function speakIfAllowed(phrase: string): boolean {
    if (degraded && !deps.isCached(phrase)) return false;
    deps.speak(phrase);
    return true;
  }

  function cancelTimer(): void {
    if (pendingTimer !== undefined) {
      clearTimer(pendingTimer);
      pendingTimer = undefined;
      pendingKind = undefined;
    }
  }

  function jitteredDelay(base: number, jitterMs: number): number {
    return Math.max(0, base + (rng() * 2 - 1) * jitterMs);
  }

  function scheduleRepeat(): void {
    cancelTimer();
    const { gapMs, jitterMs, gapGrowth } = deps.getTiming();
    const delay = jitteredDelay(gapMs * gapGrowth ** repeatsSpoken, jitterMs);
    pendingKind = "repeat";
    pendingTimer = setTimer(() => {
      pendingTimer = undefined;
      pendingKind = undefined;
      if (!active || phase !== "filler" || longWaitFired) return;
      const phrase = repeatBag.draw(deps.getPools().repeat);
      const spoke = phrase !== undefined && speakIfAllowed(phrase);
      repeatsSpoken++;
      // Nothing played (empty pool, or a degraded skip) — no onUtteranceDone will ever arrive for
      // this cycle, so the loop has to drive itself forward instead of waiting on one.
      if (!spoke) armNextFillerStep();
    }, delay);
  }

  function scheduleLongWait(): void {
    cancelTimer();
    const { longWaitMs } = deps.getTiming();
    pendingKind = "long_wait";
    pendingTimer = setTimer(() => {
      pendingTimer = undefined;
      pendingKind = undefined;
      if (!active || longWaitFired) return;
      longWaitFired = true;
      const phrase = longWaitBag.draw(deps.getPools().long_wait);
      if (phrase !== undefined) speakIfAllowed(phrase);
    }, longWaitMs);
  }

  // Arms whatever comes next in phase "filler": another backed-off repeat, or — once max_repeats
  // is spent — the single long_wait phrase.
  function armNextFillerStep(): void {
    if (repeatsSpoken < deps.getTiming().maxRepeats) scheduleRepeat();
    else scheduleLongWait();
  }

  return {
    start() {
      cancelTimer();
      active = true;
      degraded = false;
      phase = "filler";
      longWaitFired = false;
      repeatsSpoken = 0;
      spokenToolIds = new Set();
      defaultSpokenCount = 0;
      const pool = deps.getPools();
      if (pool.first.length > 0) {
        const phrase = firstBag.draw(pool.first);
        if (phrase !== undefined) speakIfAllowed(phrase);
      } else if (pool.repeat.length > 0 || pool.long_wait.length > 0) {
        // Even with an empty repeat pool, the self-driving repeat callback (see scheduleRepeat)
        // carries nothing-to-speak cycles forward until long_wait is reached.
        armNextFillerStep();
      }
    },

    onUtteranceDone() {
      if (!active || longWaitFired || phase !== "filler") return;
      armNextFillerStep();
    },

    onToolRunning(toolId) {
      if (!active || longWaitFired) return;
      phase = "tool";
      if (!spokenToolIds.has(toolId)) {
        spokenToolIds.add(toolId);
        const pool = deps.getPools();
        const toolPool = pool.tool[toolId];
        if (toolPool && toolPool.length > 0) {
          const phrase = toolBagFor(toolId).draw(toolPool);
          if (phrase !== undefined) speakIfAllowed(phrase);
        } else {
          const defaultPool = pool.tool[DEFAULT_TOOL_KEY] ?? [];
          if (defaultSpokenCount < defaultPool.length) {
            const phrase = defaultToolBag.draw(defaultPool);
            if (phrase !== undefined) {
              speakIfAllowed(phrase);
              defaultSpokenCount++;
            }
          }
        }
      }
      scheduleLongWait();
    },

    onActivity() {
      if (!active || longWaitFired) return;
      if (pendingKind === "long_wait") scheduleLongWait();
    },

    onSynthFailure() {
      // A synth failure is orthogonal to what the loop already had scheduled — cancelling here
      // must not just abandon that timer, so remember its kind and re-arm the same one.
      const cancelledKind = pendingKind;
      cancelTimer();
      if (!degraded) {
        degraded = true;
        const speakable = deps.getPools().repeat.filter(deps.isCached).length;
        log.warn("filler_degraded", { speakable });
      }
      if (!active || longWaitFired) return;
      if (cancelledKind === "repeat") scheduleRepeat();
      else if (cancelledKind === "long_wait") scheduleLongWait();
    },

    stop() {
      active = false;
      cancelTimer();
    },
  };
}
