/** Where a docked window sits beside its owner, in screen logical px: the shared rules the quick card and the Threads window place by. */

import { clampToWorkArea } from "../geometry/screen-geometry";

/** A dropped window within this distance (logical px) of its owner's edge snaps back beside it. */
const DOCK_SNAP_PX = 24;

export type DockSide = "left" | "right";

/** A monitor's work area in screen logical px. */
export interface DockWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockPlacement {
  /** The window's top-left, in screen logical px. */
  x: number;
  y: number;
  side: DockSide;
}

/** The owner's on-screen extent, plus the y the docked window hangs from. */
export interface DockAnchor {
  left: number;
  right: number;
  y: number;
}

export interface DockSize {
  width: number;
  height: number;
}

/** The side of the owner with more free work area; right on a tie. */
export function roomierSide(
  anchor: { left: number; right: number },
  workArea: DockWorkArea,
): DockSide {
  const freeLeft = anchor.left - workArea.x;
  const freeRight = workArea.x + workArea.width - anchor.right;
  return freeRight >= freeLeft ? "right" : "left";
}

/** The window's top-left moved into `bounds` for a window box of `box`. */
export function clampDock(
  at: { x: number; y: number },
  box: DockSize,
  bounds: DockWorkArea,
): { x: number; y: number } {
  return clampToWorkArea(
    at.x,
    at.y,
    box.width,
    box.height,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  );
}

/** The work area pulled `inset` inside on every edge. */
export function insetWorkArea(workArea: DockWorkArea, inset: number): DockWorkArea {
  return {
    x: workArea.x + inset,
    y: workArea.y + inset,
    width: workArea.width - inset * 2,
    height: workArea.height - inset * 2,
  };
}

/** The docked window's x on `side`: its visible edge, `inset` inside the box, `gap` from the anchor's edge. */
export function dockedX(
  side: DockSide,
  anchor: { left: number; right: number },
  box: DockSize,
  inset: number,
  gap: number,
): number {
  return side === "right" ? anchor.right + gap - inset : anchor.left - gap - box.width + inset;
}

/**
 * Where a docked window goes after its owner moved by `delta`: the same delta, vertically
 * clamped; when the move would carry the window out of `bounds` on its side, docked on the
 * other side of the owner instead.
 */
export function followOwner({
  window: at,
  delta,
  box,
  bounds,
  beside,
}: {
  /** The docked window's placement. */
  window: DockPlacement;
  delta: { dx: number; dy: number };
  box: DockSize;
  bounds: DockWorkArea;
  /** The docked placement on a side, for the flip. */
  beside(side: DockSide): DockPlacement;
}): DockPlacement {
  const movedX = at.x + delta.dx;
  const keepsSide = movedX >= bounds.x && movedX + box.width <= bounds.x + bounds.width;
  if (keepsSide) {
    return {
      ...clampDock({ x: movedX, y: at.y + delta.dy }, box, bounds),
      side: at.side,
    };
  }
  return beside(at.side === "left" ? "right" : "left");
}

/**
 * The docked position a dropped window snaps to when its visible edge lies within
 * `DOCK_SNAP_PX` of its owner's edge on one side and its span overlaps the owner window's,
 * keeping its dropped top; null keeps it detached.
 */
export function snapTarget({
  anchor,
  owner,
  dropped,
  box,
  inset,
  gap,
  bounds,
}: {
  anchor: { left: number; right: number };
  /** The owner window's on-screen box, for the vertical-overlap test. */
  owner: { y: number; height: number };
  /** The dropped window's top-left. */
  dropped: { x: number; y: number };
  box: DockSize;
  inset: number;
  gap: number;
  bounds: DockWorkArea;
}): DockPlacement | null {
  const visible = {
    left: dropped.x + inset,
    right: dropped.x + box.width - inset,
    top: dropped.y + inset,
    bottom: dropped.y + box.height - inset,
  };
  const overlapsOwner = visible.top < owner.y + owner.height && visible.bottom > owner.y;
  if (!overlapsOwner) return null;
  const nearLeft = Math.abs(anchor.left - visible.right) <= DOCK_SNAP_PX;
  const nearRight = Math.abs(visible.left - anchor.right) <= DOCK_SNAP_PX;
  if (!nearLeft && !nearRight) return null;
  const side = nearLeft ? "left" : "right";
  return {
    ...clampDock({ x: dockedX(side, anchor, box, inset, gap), y: dropped.y }, box, bounds),
    side,
  };
}
