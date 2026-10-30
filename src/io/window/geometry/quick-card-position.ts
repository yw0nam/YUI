/** Where the quick-card window sits, in screen logical px: the card's margin box docked beside her. */

import {
  clampDock,
  type DockAnchor,
  type DockPlacement,
  type DockSide,
  type DockSize,
  type DockWorkArea,
  dockedX,
  roomierSide,
} from "../dock/dock-position";

/** The card's width (logical px); the stylesheet sets the same. */
export const QUICK_CARD_WIDTH_PX = 272;
/** Transparent margin around the card inside its window, for the shadow; the stylesheet sets the same. */
export const QUICK_CARD_MARGIN_PX = 8;
/** Gap (logical px) between the character's edge and the card's visible edge while docked. */
export const QUICK_CARD_GAP_PX = 12;
/** How far above the click's y the card's visible top sits while docked. */
const DOCK_TOP_OFFSET_PX = 24;

/** The window box the card content plus its margin fills. */
export function quickCardBox(content: DockSize): DockSize {
  return {
    width: content.width + QUICK_CARD_MARGIN_PX * 2,
    height: content.height + QUICK_CARD_MARGIN_PX * 2,
  };
}

/** Where the card window sits docked beside her, clamped into the work area. */
export function quickCardBeside({
  character,
  content,
  workArea,
  side,
}: {
  /** The character's on-screen extent and the click's y, in screen logical px. */
  character: DockAnchor;
  /** The card's content size; the window box adds the margin on every side. */
  content: DockSize;
  workArea: DockWorkArea;
  /** Forced side; absent, the roomier side of the work area. */
  side?: DockSide;
}): DockPlacement {
  const chosen = side ?? roomierSide(character, workArea);
  const box = quickCardBox(content);
  const at = clampDock(
    {
      x: dockedX(chosen, character, box, QUICK_CARD_MARGIN_PX, QUICK_CARD_GAP_PX),
      y: character.y - DOCK_TOP_OFFSET_PX - QUICK_CARD_MARGIN_PX,
    },
    box,
    workArea,
  );
  return { ...at, side: chosen };
}
