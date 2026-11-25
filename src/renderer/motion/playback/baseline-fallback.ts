/**
 * baseline-fallback — idle-fallback decision for a motion whose clip fails to load.
 *
 * playMotion commits the motion decision *before* the async clip load resolves, so a
 * failed load (missing/invalid VRMA — e.g. a gitignored purchased motion absent locally)
 * leaves the controller pinned at the dead id: `current` and, for kind:"state"/"ambient",
 * `previousStable` both reference a motion that never played, and a later lower-priority
 * idle is blocked by request() priority.
 *
 * This repairs that by force-committing the motion's own `fallback` once, or else idle
 * (bypassing request() so priority cannot block it). Overwriting with idle
 * (kind:"ambient") resets both `current` and `previousStable`. The renderer then
 * (re)plays the returned motion via startMotion.
 *
 * Honors public/purchased_motions/AGENTS.md: a missing purchased clip plays its motion's
 * fallback (`thinking` → `thinking_free`). General to ANY motion, not thinking-specific.
 */

import type { MotionController, ResolvedMotion } from "./motion-controller";

/**
 * Resolves and force-commits recovery for `failedId`'s dead clip: its own `fallback` when
 * one is set and registered, otherwise the baseline. Returns the motion for the renderer to
 * (re)play, or null when no recovery should run:
 *  - `failedId === controller.baseline()` → recursion guard (the baseline's own load
 *    failed; do not loop).
 *  - neither a registered fallback nor the baseline is available → nothing to play.
 */
export function resolveBaselineFallback(
  controller: MotionController,
  failedId: string,
  fallbackId?: string,
): ResolvedMotion | null {
  const baselineId = controller.baseline();
  if (failedId === baselineId) return null;
  if (fallbackId !== undefined) {
    const fallback = controller.resolve({ id: fallbackId });
    if (fallback) {
      // Force-commit (not request()) so the dead motion's priority can't block the fallback.
      controller.commit({ action: "play", motion: fallback });
      return fallback;
    }
  }
  const baseline = controller.resolve({ id: baselineId });
  if (!baseline) return null;
  // Force-commit (not request()) so the dead motion's priority can't block the baseline.
  controller.commit({ action: "play", motion: baseline });
  return baseline;
}
