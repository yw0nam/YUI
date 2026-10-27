/** Where the quick-card window sits, in screen logical px: docked beside her, following her, snapping back. */

import { clampToWorkArea } from "./screen-geometry";

/** The card's width (logical px); the stylesheet sets the same. */
export const QUICK_CARD_WIDTH_PX = 272;
/** Transparent margin around the card inside its window, for the shadow; the stylesheet sets the same. */
export const QUICK_CARD_MARGIN_PX = 8;
/** Gap (logical px) between the character's edge and the card's visible edge while docked. */
export const QUICK_CARD_GAP_PX = 12;
/** A dropped card within this distance (logical px) of her edge snaps back beside her. */
export const QUICK_CARD_SNAP_PX = 24;
/** How far above the click's y the card's top sits while docked. */
const DOCK_TOP_OFFSET_PX = 24;

export type QuickCardSide = "left" | "right";

/** A monitor's work area in screen logical px. */
export interface QuickCardWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuickCardPlacement {
  /** The card window's top-left, in screen logical px. */
  x: number;
  y: number;
  side: QuickCardSide;
}

type Size = { width: number; height: number };

interface BesideInput {
  /** The character's on-screen extent and the click's y, in screen logical px. */
  character: { left: number; right: number; y: number };
  /** The card's content size; the window box adds the margin on every side. */
  content: Size;
  workArea: QuickCardWorkArea;
  /** Forced side; absent, the roomier side of the work area. */
  side?: QuickCardSide;
}

/** The window box the card content plus its margin fills. */
export function quickCardBox(content: Size): Size {
  return {
    width: content.width + QUICK_CARD_MARGIN_PX * 2,
    height: content.height + QUICK_CARD_MARGIN_PX * 2,
  };
}

/** The window's top-left moved into the work area for a window box of `box`. */
export function clampQuickCard(
  at: { x: number; y: number },
  box: Size,
  workArea: QuickCardWorkArea,
): { x: number; y: number } {
  return clampToWorkArea(
    at.x,
    at.y,
    box.width,
    box.height,
    workArea.x,
    workArea.y,
    workArea.width,
    workArea.height,
  );
}

function dockedX(
  side: QuickCardSide,
  character: { left: number; right: number },
  contentWidth: number,
): number {
  return side === "right"
    ? character.right + QUICK_CARD_GAP_PX - QUICK_CARD_MARGIN_PX
    : character.left - QUICK_CARD_GAP_PX - contentWidth - QUICK_CARD_MARGIN_PX;
}

function roomierSide(
  character: { left: number; right: number },
  workArea: QuickCardWorkArea,
): QuickCardSide {
  const freeLeft = character.left - workArea.x;
  const freeRight = workArea.x + workArea.width - character.right;
  return freeRight >= freeLeft ? "right" : "left";
}

/** Where the card window sits docked beside her, clamped into the work area. */
export function quickCardBeside({
  character,
  content,
  workArea,
  side,
}: BesideInput): QuickCardPlacement {
  const chosen = side ?? roomierSide(character, workArea);
  const at = clampQuickCard(
    {
      x: dockedX(chosen, character, content.width),
      y: character.y - DOCK_TOP_OFFSET_PX - QUICK_CARD_MARGIN_PX,
    },
    quickCardBox(content),
    workArea,
  );
  return { ...at, side: chosen };
}

/**
 * Where a docked card goes after the owner window moved by `delta`: the same delta, vertically
 * clamped; when the move would carry the card out of the work area on its side, docked on the
 * other side of her instead.
 */
export function followOwner({
  character,
  card,
  delta,
  content,
  workArea,
}: BesideInput & {
  card: QuickCardPlacement;
  delta: { dx: number; dy: number };
}): QuickCardPlacement {
  const box = quickCardBox(content);
  const movedX = card.x + delta.dx;
  const keepsSide = movedX >= workArea.x && movedX + box.width <= workArea.x + workArea.width;
  if (keepsSide) {
    return {
      ...clampQuickCard({ x: movedX, y: card.y + delta.dy }, box, workArea),
      side: card.side,
    };
  }
  return quickCardBeside({
    character,
    content,
    workArea,
    side: card.side === "left" ? "right" : "left",
  });
}

/**
 * The docked position a dropped card snaps to when its visible edge lies within
 * `QUICK_CARD_SNAP_PX` of her edge on one side and its span overlaps the owner window's,
 * keeping its dropped top; null keeps it detached.
 */
export function snapTarget({
  character,
  owner,
  card,
  content,
  workArea,
}: Omit<BesideInput, "side" | "character"> & {
  character: { left: number; right: number };
  /** The owner pet window's on-screen box, for the vertical-overlap test. */
  owner: { y: number; height: number };
  /** The dropped card window's top-left. */
  card: { x: number; y: number };
}): QuickCardPlacement | null {
  const visible = {
    left: card.x + QUICK_CARD_MARGIN_PX,
    right: card.x + content.width + QUICK_CARD_MARGIN_PX,
    top: card.y + QUICK_CARD_MARGIN_PX,
    bottom: card.y + content.height + QUICK_CARD_MARGIN_PX,
  };
  const overlapsOwner = visible.top < owner.y + owner.height && visible.bottom > owner.y;
  if (!overlapsOwner) return null;
  const nearLeft = Math.abs(character.left - visible.right) <= QUICK_CARD_SNAP_PX;
  const nearRight = Math.abs(visible.left - character.right) <= QUICK_CARD_SNAP_PX;
  if (!nearLeft && !nearRight) return null;
  const side = nearLeft ? "left" : "right";
  const at = clampQuickCard(
    { x: dockedX(side, character, content.width), y: card.y },
    quickCardBox(content),
    workArea,
  );
  return { ...at, side };
}
