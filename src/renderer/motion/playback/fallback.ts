/** Fallback recovery for a motion whose clip fails to load. */

import type { MotionController, ResolvedMotion } from "./motion-controller";

/** Recovery target for a clip that failed to load: the motion's fallback, else the baseline. */
export function resolveFallback(
  controller: MotionController,
  failedId: string,
  fallbackId?: string,
): ResolvedMotion | null {
  const baselineId = controller.baseline();
  if (failedId === baselineId) return null;
  const motion =
    (fallbackId !== undefined ? controller.resolve({ id: fallbackId }) : null) ??
    controller.resolve({ id: baselineId });
  if (!motion) return null;
  // Force-commit (not request()) so the dead motion's priority can't block the recovery.
  controller.commit({ action: "play", motion });
  return motion;
}
