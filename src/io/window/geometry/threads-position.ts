/**
 * The Threads window's box in screen logical px: beside the main pet window on its first open,
 * at its stored frame after that, and its resize. The box is the native window; the panel sits
 * `THREADS_PANEL_INSET_PX` inside it.
 */

import type { ScreenRect } from "../../../contract";
import { THREADS_MIN_PANEL } from "../../../settings/threads/threads-window-settings";
import { roomierSide } from "../dock/dock-position";
import { clampToWorkArea, logicalWorkArea, type ScreenMonitor } from "./screen-geometry";

/** The gap from the pet window to the window's box, and the box's inset from the work area's edges. */
export const THREADS_GAP_PX = 12;
/** Transparent padding around the panel inside its window, for the shadow; the stylesheet sets the same. */
export const THREADS_PANEL_INSET_PX = 8;

/** The edge or corner a resize drags. */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The work area less the gap on every side: the bounds the box stays in. */
function boundsOf(workArea: ScreenRect): ScreenRect {
  return {
    x: workArea.x + THREADS_GAP_PX,
    y: workArea.y + THREADS_GAP_PX,
    width: workArea.width - 2 * THREADS_GAP_PX,
    height: workArea.height - 2 * THREADS_GAP_PX,
  };
}

/** The smallest box inside `bounds`: the minimum panel's, unless the bounds cannot hold it. */
function minBox(bounds: ScreenRect): { width: number; height: number } {
  return {
    width: Math.min(THREADS_MIN_PANEL.width + 2 * THREADS_PANEL_INSET_PX, bounds.width),
    height: Math.min(THREADS_MIN_PANEL.height + 2 * THREADS_PANEL_INSET_PX, bounds.height),
  };
}

const within = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `box` sized into `bounds` (never below the minimum box, the bounds winning) and moved inside them. */
function fitBox(box: ScreenRect, bounds: ScreenRect): ScreenRect {
  const min = minBox(bounds);
  const width = within(box.width, min.width, bounds.width);
  const height = within(box.height, min.height, bounds.height);
  const at = clampToWorkArea(
    box.x,
    box.y,
    width,
    height,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  );
  return { ...at, width, height };
}

/**
 * The first open's box: 12px beside `pet` on its roomier side, the wanted `panel` narrowed to the
 * room there (never below the minimum), clamped 12px inside the work area.
 */
export function threadsWindowRect({
  pet,
  workArea,
  panel,
}: {
  pet: Pick<ScreenRect, "x" | "y" | "width">;
  workArea: ScreenRect;
  panel: { width: number; height: number };
}): ScreenRect {
  const bounds = boundsOf(workArea);
  const side = roomierSide({ left: pet.x, right: pet.x + pet.width }, workArea);
  const room =
    side === "right"
      ? bounds.x + bounds.width - (pet.x + pet.width + THREADS_GAP_PX)
      : pet.x - THREADS_GAP_PX - bounds.x;
  const width = Math.min(room, panel.width + 2 * THREADS_PANEL_INSET_PX);
  const x = side === "right" ? pet.x + pet.width + THREADS_GAP_PX : pet.x - THREADS_GAP_PX - width;
  return fitBox({ x, y: pet.y, width, height: panel.height + 2 * THREADS_PANEL_INSET_PX }, bounds);
}

/** The logical work area nearest `point`: the one holding it, else the closest by distance. */
export function nearestWorkArea(
  point: { x: number; y: number },
  monitors: ScreenMonitor[],
): ScreenRect | null {
  let best: ScreenRect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const area of monitors.map(logicalWorkArea)) {
    const dx = Math.max(area.x - point.x, 0, point.x - (area.x + area.width));
    const dy = Math.max(area.y - point.y, 0, point.y - (area.y + area.height));
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) [best, bestDistance] = [area, distance];
  }
  return best;
}

/** A stored panel frame's box, sized into and moved inside the nearest monitor's work area less 12px. */
export function restoreThreadsBox(panel: ScreenRect, monitors: ScreenMonitor[]): ScreenRect {
  const box = {
    x: panel.x - THREADS_PANEL_INSET_PX,
    y: panel.y - THREADS_PANEL_INSET_PX,
    width: panel.width + 2 * THREADS_PANEL_INSET_PX,
    height: panel.height + 2 * THREADS_PANEL_INSET_PX,
  };
  const area = nearestWorkArea({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, monitors);
  return area ? fitBox(box, boundsOf(area)) : box;
}

/**
 * `box` resized by dragging `edge` by `dx`, `dy` (screen px): the dragged sides move, the box
 * stays between the minimum box and the work area less 12px on every side. A side already past
 * that area stays where it is until dragged back in, and never pulls the box below the minimum.
 */
export function resizeThreadsBox(
  box: ScreenRect,
  workArea: ScreenRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
): ScreenRect {
  const bounds = boundsOf(workArea);
  const min = minBox(bounds);
  let [left, top, right, bottom] = [box.x, box.y, box.x + box.width, box.y + box.height];
  const [maxRight, maxBottom] = [bounds.x + bounds.width, bounds.y + bounds.height];
  if (edge.includes("e")) right = within(right + dx, left + min.width, Math.max(maxRight, right));
  if (edge.includes("w")) left = within(left + dx, Math.min(bounds.x, left), right - min.width);
  if (edge.includes("s"))
    bottom = within(bottom + dy, top + min.height, Math.max(maxBottom, bottom));
  if (edge.includes("n")) top = within(top + dy, Math.min(bounds.y, top), bottom - min.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The chip's screen rect moved into the window's own bounds, in window-local px: where the grow starts. */
export function chipInWindow(chip: ScreenRect, window: ScreenRect): ScreenRect {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  return {
    x: clamp(chip.x - window.x, window.width - chip.width),
    y: clamp(chip.y - window.y, window.height - chip.height),
    width: chip.width,
    height: chip.height,
  };
}
