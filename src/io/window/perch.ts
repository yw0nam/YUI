/** Perch values and the host-edge span that the drop source and the locomotion loops share. */
import type { ScreenRect, WindowRect } from "../../contract";
import type { ScreenPoint } from "../../renderer/geometry/perch-geometry";

/** Registry id of the clip that holds the character in place for as long as she is perched. */
export const PERCH_MOTION_ID = "window_sit";
/** Poll cadence — ~1.4 Hz keeps detach latency under ~2 ticks (≈1.4 s). */
export const PERCH_POLL_MS = 700;
/** Consecutive lost ticks required for an *ambiguous* loss (covered / moved). */
export const PERCH_AMBIGUOUS_LOST_TICKS = 2;
/** Px threshold below which armed-window movement is treated as jitter, not a move. */
export const MOVE_TH = 12;

/** Point-in-rect: is the seat actually over this window's surface (points). */
export function containsSeat(win: ScreenRect, seat: ScreenPoint): boolean {
  return (
    seat.x >= win.x &&
    seat.x <= win.x + win.width &&
    seat.y >= win.y &&
    seat.y <= win.y + win.height
  );
}

/**
 * The stretch of the host's top edge reachable from `currentX`, in the z-ordered
 * front-to-back window list the perch poll reads. A window in front of the host that
 * reaches that edge detaches the perch the moment the seat lands under it, so it bounds
 * the walk on whichever side of the seat it lies. A window straddling `currentX` leaves
 * left past right — the seat is boxed in and there is nothing to walk.
 */
export function uncoveredSpan(
  windows: WindowRect[],
  hostIndex: number,
  currentX: number,
): { left: number; right: number } {
  const host = windows[hostIndex];
  let left = host.x;
  let right = host.x + host.width;
  for (let i = 0; i < hostIndex; i++) {
    const w = windows[i];
    // Its own left edge on the host's edge line asks the one question left: whether this
    // window reaches that line at all.
    if (!containsSeat(w, { x: w.x, y: host.y })) continue;
    if (w.x + w.width > currentX) right = Math.min(right, w.x);
    if (w.x < currentX) left = Math.max(left, w.x + w.width);
  }
  return { left, right };
}
