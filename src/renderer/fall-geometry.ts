/**
 * fall-geometry — pure math for the perched-character fall (#143).
 *
 * No three.js side effects, no DOM. Plain arithmetic over plain values, so it
 * runs in vitest node env (same pattern as perch-geometry.ts).
 *
 * Units: all inputs/outputs are logical px / points
 * (pet-window CSS px == logical px == points), top-left origin.
 */

import type { ScreenRect } from "../contract";

/**
 * Clamp a window's top-left (x, y) so a w×h window stays within the work area.
 * Literal port of the Rust `clamp_to_work_area` (drag.rs): for each axis
 * `.max(origin)` first, then `.min(origin + size - dim)`. When the window is
 * larger than the area the min bound is < origin, so the result is that smaller
 * value (it does NOT pin to the top-left) — matching the Rust order exactly.
 */
export function clampToWorkArea(
  x: number,
  y: number,
  w: number,
  h: number,
  area: ScreenRect,
): { x: number; y: number } {
  const clampedX = Math.min(Math.max(x, area.x), area.x + area.width - w);
  const clampedY = Math.min(Math.max(y, area.y), area.y + area.height - h);
  return { x: clampedX, y: clampedY };
}
