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

/**
 * Tracks VRMA paths whose fetch/parse failed for a reason no retry can fix — above all
 * a purchased motion absent from the bundle (gitignored, non-redistributable). The first
 * failure warns with the path; from then on the loader skips the network entirely and
 * the renderer falls straight back to the baseline, so a missing asset costs one warn
 * per session instead of an error per turn.
 */
export function createDeadClipRegistry(log: {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}): {
  isDead: (vrmaPath: string) => boolean;
  markDead: (vrmaPath: string, error: unknown) => void;
} {
  const dead = new Set<string>();
  return {
    isDead: (vrmaPath) => dead.has(vrmaPath),
    markDead(vrmaPath, error) {
      if (dead.has(vrmaPath)) return;
      dead.add(vrmaPath);
      log.warn("vrma_load_failed", { vrma_path: vrmaPath, error: String(error) });
    },
  };
}
