import type { MotionKind, MotionSignal } from "../contract";

/** A held posture ignores idle returns and non-state motion requests. */
export function suppressWhileHeld(
  requested: MotionSignal | null,
  held: boolean,
  kindOf: (id: string) => MotionKind | undefined,
): boolean {
  return held && (requested === null || kindOf(requested.id) !== "state");
}
