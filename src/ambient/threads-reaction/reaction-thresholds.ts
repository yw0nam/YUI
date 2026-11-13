/** reaction-thresholds — the waiting-count edge and the per-Thread long wait that start a Thread reaction without a chip tap. */

import type { Thread } from "../../contract";

export type ThresholdReach = { cause: "count" } | { cause: "wait"; threadId: string };

export function createReactionThresholds(_deps: {
  count(): number;
  waitMs(): number;
  now(): number;
  onReach(cause: ThresholdReach): void;
}): { next(counted: readonly Thread[]): void; recheck(): void; dispose(): void } {
  return {
    next(_counted) {},
    recheck() {},
    dispose() {},
  };
}
