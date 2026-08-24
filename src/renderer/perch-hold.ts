import type { MotionKind, MotionSignal } from "../contract";

/** A held posture ignores idle returns and non-state motion requests. */
export function suppressWhileHeld(
  requested: MotionSignal | null,
  held: boolean,
  kindOf: (id: string) => MotionKind | undefined,
): boolean {
  return held && (requested === null || kindOf(requested.id) !== "state");
}

/** A held posture restores its last state motion instead of the ambient baseline. */
export function baselineWhileHeld(
  held: boolean,
  lastStateId: string | null,
  baseline: string,
): string {
  return held && lastStateId ? lastStateId : baseline;
}
