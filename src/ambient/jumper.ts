/**
 * Jumping across to an adjacent foreign window's top.
 *
 * A perched stroll that finds a reachable neighbour walks to the host's edge on that
 * side and jumps: the VRM plays the in-place jump clip at scene origin while the OS
 * window travels a parabola from one window top to the other. Only the clip's airborne
 * stretch moves the window — the crouch and the recovery play where they are.
 *
 * Eligibility and the arc are pure functions; createJumper owns the clip, the per-frame
 * travel and the watch that catches the target window leaving mid-flight.
 */

import type { JumpConfig } from "../config/load";
import type { WindowRect } from "../contract";
import { containsSeat } from "../io/window-drop-source";

/** Registry id of the clip the whole jump is paced by. */
export const JUMP_MOTION_ID = "jump";

/** Where a jump goes: the window it lands on, and the two points it runs between. */
export interface JumpPlan {
  target: WindowRect;
  side: "left" | "right";
  /** Global x (logical px) the feet leave the host from. */
  takeoffX: number;
  /** Global x the feet come down on. */
  landingX: number;
}

/**
 * The neighbouring window top she can reach from the host, or null when none can be.
 * `span` is the host stretch she can actually walk to (the stroll's own uncovered span),
 * and `margin` the stroll's edge margin — the takeoff and the landing both stay inside it.
 * Nearest gap wins; a tie goes to the smaller height difference.
 */
export function pickJumpTarget(args: {
  /** Front-to-back, topmost first. */
  windows: WindowRect[];
  hostIndex: number;
  span: { left: number; right: number };
  charHpx: number;
  charWpx: number;
  margin: number;
  cfg: JumpConfig;
}): JumpPlan | null {
  const { windows, hostIndex, span, charHpx, charWpx, margin, cfg } = args;
  const host = windows[hostIndex];
  if (!host) return null;
  let best: { plan: JumpPlan; gap: number; rise: number } | null = null;

  for (const [index, candidate] of windows.entries()) {
    if (index === hostIndex) continue;
    const rise = Math.abs(candidate.y - host.y);
    const limit = candidate.y < host.y ? cfg.height_up_max_frac : cfg.height_down_max_frac;
    if (rise > limit * charHpx) continue;
    // The larger of the two facing-edge distances names the side she leaves on: positive
    // means the candidate is clear of the host, negative that the two windows overlap.
    const toRight = candidate.x - (host.x + host.width);
    const toLeft = host.x - (candidate.x + candidate.width);
    const side = toRight >= toLeft ? "right" : "left";
    const gap = Math.max(0, side === "right" ? toRight : toLeft);
    if (gap > cfg.gap_max_width_frac * charWpx) continue;
    if (best && (gap > best.gap || (gap === best.gap && rise >= best.rise))) continue;

    const takeoffX = side === "right" ? host.x + host.width - margin : host.x + margin;
    if (takeoffX < span.left || takeoffX > span.right) continue;
    // Across a gap she lands just inside the near edge; over an overlap the near edge is
    // behind her, so she carries one body width past the host's own.
    const landingX =
      gap > 0
        ? side === "right"
          ? candidate.x + margin
          : candidate.x + candidate.width - margin
        : takeoffX + (side === "right" ? charWpx : -charWpx);
    if (landingX < candidate.x + margin || landingX > candidate.x + candidate.width - margin) {
      continue;
    }
    const seat = { x: landingX, y: candidate.y };
    if (windows.some((front, i) => i < index && containsSeat(front, seat))) continue;

    best = { plan: { target: candidate, side, takeoffX, landingX }, gap, rise };
  }
  return best?.plan ?? null;
}

/**
 * Screen y of the flight at `u` in [0, 1], between the two window tops. The apex sits
 * `lift` above the higher of them, so a jump up and a jump down clear the same headroom.
 */
export function jumpArc(u: number, from: number, to: number, lift: number): number {
  const apex = lift + Math.abs(to - from) / 2;
  return (1 - u) * from + u * to - 4 * apex * u * (1 - u);
}
