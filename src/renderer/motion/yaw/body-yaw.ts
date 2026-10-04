/**
 * body-yaw — pure easing math for the root yaw the ambient stroll turns the
 * character by. No three.js, no DOM: the renderer holds the transition state and
 * writes the result onto the VRM scene root each frame.
 */

/** Smoothstep 0→1. Flat at both ends, so a yaw transition never snaps. */
export function easeInOut(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Yaw (rad) `elapsedMs` into an eased `from`→`to` transition of `durationMs`. */
export function yawAt(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return to;
  return from + (to - from) * easeInOut(elapsedMs / durationMs);
}
