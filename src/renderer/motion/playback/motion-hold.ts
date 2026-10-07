import type { MotionSignal } from "../../../contract";

/** A hold drops idle returns and every motion request outside its ids. */
export function dropUnderHold(
  requested: MotionSignal | null,
  hold: readonly string[] | null,
): boolean {
  return hold !== null && (requested === null || !hold.includes(requested.id));
}

/** A held motion's finish stays clamped on its last frame instead of chaining. */
export function clampUnderHold(finishedId: string, hold: readonly string[] | null): boolean {
  return hold?.includes(finishedId) ?? false;
}
