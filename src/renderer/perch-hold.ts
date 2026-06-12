import type { MotionSignal } from "../contract";

/** While perched, an implicit idle return (null motion) is a no-op so the held perch survives. */
export function suppressIdleReturn(requested: MotionSignal | null, perchActive: boolean): boolean {
  return requested === null && perchActive;
}
