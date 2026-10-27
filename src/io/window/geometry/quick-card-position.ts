/**
 * quick-card-position — the pure placement rules of the quick-card window: docked beside the
 * character, travelling with her window, and the magnet that snaps a dropped card back.
 *
 * All values are screen logical px. The caller reads the owner pet window's outer position and
 * scale, adds the request's window-relative offsets to it, picks the work area of the monitor to
 * place against, and passes the card's content size plus the transparent margin its window adds.
 */

import { clampToWorkArea } from "./screen-geometry";

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

interface BesideInput {
  /** The character's on-screen extent and the click's y, in screen logical px. */
  character: { left: number; right: number; y: number };
  /** The card's content size; the window box adds the margin on every side. */
  window: { width: number; height: number };
  margin: number;
  workArea: QuickCardWorkArea;
  /** Forced side; absent, the roomier side of the work area. */
  side?: QuickCardSide;
}

/** The window box the card content plus its margin fills. */
function boxSize(window: { width: number; height: number }, margin: number) {
  return { width: window.width + margin * 2, height: window.height + margin * 2 };
}

function dockedX(
  side: QuickCardSide,
  character: { left: number; right: number },
  cardWidth: number,
  margin: number,
): number {
  return side === "right"
    ? character.right + QUICK_CARD_GAP_PX - margin
    : character.left - QUICK_CARD_GAP_PX - cardWidth - margin;
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
  window: card,
  margin,
  workArea,
  side,
}: BesideInput): QuickCardPlacement {
  const chosen = side ?? roomierSide(character, workArea);
  const box = boxSize(card, margin);
  const clamped = clampToWorkArea(
    dockedX(chosen, character, card.width, margin),
    character.y - DOCK_TOP_OFFSET_PX - margin,
    box.width,
    box.height,
    workArea.x,
    workArea.y,
    workArea.width,
    workArea.height,
  );
  return { x: clamped.x, y: clamped.y, side: chosen };
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
  window: cardSize,
  margin,
  workArea,
}: BesideInput & {
  card: QuickCardPlacement;
  delta: { dx: number; dy: number };
}): QuickCardPlacement {
  const box = boxSize(cardSize, margin);
  const movedX = card.x + delta.dx;
  const keepsSide =
    movedX >= workArea.x && movedX + box.width <= workArea.x + workArea.width;
  if (keepsSide) {
    const clamped = clampToWorkArea(
      movedX,
      card.y + delta.dy,
      box.width,
      box.height,
      workArea.x,
      workArea.y,
      workArea.width,
      workArea.height,
    );
    return { x: clamped.x, y: clamped.y, side: card.side };
  }
  return quickCardBeside({
    character,
    window: cardSize,
    margin,
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
  window: cardSize,
  margin,
  workArea,
}: Omit<BesideInput, "side" | "character"> & {
  character: { left: number; right: number };
  /** The owner pet window's on-screen box, for the vertical-overlap test. */
  owner: { y: number; height: number };
  /** The dropped card window's top-left. */
  card: { x: number; y: number };
}): QuickCardPlacement | null {
  const visible = {
    left: card.x + margin,
    right: card.x + cardSize.width + margin,
    top: card.y + margin,
    bottom: card.y + cardSize.height + margin,
  };
  const overlapsOwner = visible.top < owner.y + owner.height && visible.bottom > owner.y;
  if (!overlapsOwner) return null;
  const nearLeft = Math.abs(character.left - visible.right) <= QUICK_CARD_SNAP_PX;
  const nearRight = Math.abs(visible.left - character.right) <= QUICK_CARD_SNAP_PX;
  if (!nearLeft && !nearRight) return null;
  const side = nearLeft ? "left" : "right";
  const box = boxSize(cardSize, margin);
  const clamped = clampToWorkArea(
    dockedX(side, character, cardSize.width, margin),
    card.y,
    box.width,
    box.height,
    workArea.x,
    workArea.y,
    workArea.width,
    workArea.height,
  );
  return { x: clamped.x, y: clamped.y, side };
}
