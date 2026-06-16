/**
 * motion-fallback — idle-fallback decision for a motion whose clip fails to load.
 *
 * playMotion commits the motion decision *before* the async clip load resolves, so a
 * failed load (missing/invalid VRMA — e.g. a gitignored purchased motion absent locally)
 * leaves the controller pinned at the dead id: `current` and, for kind:"state"/"ambient",
 * `previousStable` both reference a motion that never played, and a later lower-priority
 * idle is blocked by request() priority.
 *
 * This repairs that by force-committing idle (bypassing request() so priority cannot
 * block it). Overwriting with idle (kind:"ambient") resets both `current` and
 * `previousStable`. The renderer then (re)plays the returned motion via startMotion.
 *
 * Honors public/purchased_motions/AGENTS.md: "if purchased motions are not present, use
 * idle". General to ANY motion, not thinking-specific.
 */

import type { MotionController, ResolvedMotion } from "./motion-controller";

/**
 * Resolves and force-commits the baseline as recovery for `failedId`'s dead clip.
 * Returns the resolved baseline motion for the renderer to (re)play, or null when no
 * fallback should run:
 *  - `failedId === controller.baseline()` → recursion guard (the baseline's own load
 *    failed; do not loop).
 *  - the baseline is not registered → nothing to fall back to.
 */
export function resolveBaselineFallback(
  controller: MotionController,
  failedId: string,
): ResolvedMotion | null {
  const baselineId = controller.baseline();
  if (failedId === baselineId) return null;
  const baseline = controller.resolve({ id: baselineId });
  if (!baseline) return null;
  // Force-commit (not request()) so the dead motion's priority can't block the baseline.
  controller.commit({ action: "play", motion: baseline });
  return baseline;
}
