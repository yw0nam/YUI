/**
 * Pure hysteresis controller deciding WHEN to request a session compaction. Watches per-turn token
 * usage and fires once per high-water episode (not every turn), re-arming only after usage drops
 * well below the threshold (the hysteresis band [resumeRatio, thresholdRatio]). No transport, no
 * timers, no judgment — the dispatcher owns the actual compaction call via onTrigger.
 */

import type { CompactResult } from "./session-compactor";

export interface CompactionTriggerOptions {
  /** chat_model_context_window; undefined → no known max, threshold never fires. */
  contextWindow?: number;
  thresholdRatio: number;
  resumeRatio: number;
  onTrigger: () => void;
}

export interface CompactionTrigger {
  /** Per-turn total token count from backend-caller onUsage. */
  noteUsage(totalTokens: number): void;
  /** Settled compaction outcome; skipped/error keep the latch closed to avoid flapping. */
  noteResult(result: CompactResult): void;
  /** Re-arm and clear suppression (conversation reset). */
  reset(): void;
}

export function createCompactionTrigger(opts: CompactionTriggerOptions): CompactionTrigger {
  const { contextWindow, thresholdRatio, resumeRatio, onTrigger } = opts;
  const thresholdTokens = contextWindow != null ? contextWindow * thresholdRatio : undefined;
  const resumeTokens = contextWindow != null ? contextWindow * resumeRatio : undefined;

  let armed = true;

  return {
    noteUsage(totalTokens: number): void {
      if (thresholdTokens == null || resumeTokens == null) return;
      if (armed) {
        if (totalTokens >= thresholdTokens) {
          armed = false;
          onTrigger();
        }
        return;
      }
      if (totalTokens < resumeTokens) armed = true;
    },

    noteResult(_result: CompactResult): void {
      // compressed/skipped/error all leave the latch as-is; re-arming happens only on a usage drop.
    },

    reset(): void {
      armed = true;
    },
  };
}
