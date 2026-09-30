/** Pointer travel (CSS px) past which a press is a drag; below it a press-release is a click or a tap. */
export const PRESS_TRAVEL_PX = 4;

/** True once the pointer has moved PRESS_TRAVEL_PX or more from where it went down. */
export function exceedsPressTravel(
  start: { x: number; y: number },
  now: { x: number; y: number },
): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= PRESS_TRAVEL_PX;
}
