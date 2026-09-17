/**
 * test-helpers.ts — the climb fixtures shared by climber.test.ts and climb-geometry.test.ts:
 * the climb config, the character metrics, and the target window the wall tests climb.
 */

import type { ClimbConfig } from "../config/load";
import type { WindowRect } from "../contract";
import type { ClimbTarget } from "./climb-geometry";

export const CFG: ClimbConfig = {
  interval_min_ms: 90_000,
  interval_max_ms: 180_000,
  perch_dwell_min_ms: 60_000,
  perch_dwell_max_ms: 120_000,
  max_height_frac: 4,
  hang_frac: 0.3,
  wall_offset_frac: 0.15,
  descent_wall_offset_frac: 0.3,
  // rng () => 0 draws the minimum, so a ledge walk is 0.3 × 500 = 150 px in.
  ledge_walk_min_frac: 0.3,
  ledge_walk_max_frac: 1.5,
};

export const CHAR_HPX = 500;
/** Feet in canvas-local logical px. */
export const ANCHOR = { x: 200, y: 420 };

export function win(over: Partial<WindowRect> = {}): WindowRect {
  return {
    x: 1000,
    y: 900,
    width: 400,
    height: 600,
    name: "Meeting notes",
    ownerName: "Notes",
    pid: 11,
    windowNumber: 42,
    ...over,
  };
}

export const TARGET_WINDOW = win();

/** Too short to climb itself, but it sits across the target's left wall column. */
export const COLUMN_COVER = win({ x: 900, y: 1300, width: 200, height: 200, windowNumber: 7 });
/** The same, across the target's right wall column. */
export const RIGHT_COLUMN_COVER = win({
  x: 1300,
  y: 1300,
  width: 200,
  height: 200,
  windowNumber: 8,
});

export const TARGET: ClimbTarget = {
  windowNumber: 42,
  side: "left",
  edgeX: 1000,
  topY: 900,
  bottomY: 1500,
  width: 400,
  rect: { x: 1000, y: 900 },
  app: "Notes",
  title: "Meeting notes",
  kind: "window",
};
